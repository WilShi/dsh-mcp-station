import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MANAGED_BLOCK_BEGIN,
  MANAGED_BLOCK_END,
  addManagedRow,
  inspectPatchText,
  listInstalledServers,
  parsePatchRows,
  readManagedBlock,
  removeManagedRow,
  renderManagedRow,
  replaceManagedRow,
  setManagedRowEnabled,
  upsertManagedBlock,
  writePatchTextAtomic,
} from '../src/patch.ts'
import type { ManagedRowInput } from '../src/patch.ts'

const EXTERNAL_PATCH = [
  '# my profile patch',
  '# keep this comment and its spacing',
  '- id: ui-theme',
  '  name: "@deepseek-ai/dsh-client-ui-theme"',
  '  config:',
  '    preference: system',
  '',
  '- insert:',
  '    - id: user-mcp-github',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        serverName: github',
  '        transport: stdio',
  '        command: npx',
  '        args:',
  '          - -y',
  '          - "@modelcontextprotocol/server-github"',
  '        env:',
  '          GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN',
  '',
  '# trailing comment',
  '',
].join('\n')

const EXTERNAL_INSERT_PATCH = [
  '# external insert patch, not owned by MCP Station',
  '- insert:',
  '    - id: custom-mcp-github',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        serverName: gh-custom',
  '        transport: stdio',
  '        command: npx',
  '        args: ["-y", "@modelcontextprotocol/server-github"]',
  '',
].join('\n')

const PLAYWRIGHT: ManagedRowInput = {
  serverName: 'playwright',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@playwright/mcp@latest', '--browser', 'chrome'],
  enabled: true,
}

/** Find the single line index whose removal turns after into before. */
function addedLineIndex(before: string[], after: string[]): number {
  for (let index = 0; index < after.length; index += 1) {
    const candidate = [...after]
    candidate.splice(index, 1)
    if (candidate.length === before.length && candidate.every((line, i) => line === before[i])) return index
  }
  return -1
}

function blockPrefix(text: string): string {
  const index = text.indexOf(MANAGED_BLOCK_BEGIN)
  return index < 0 ? text : text.slice(0, index)
}

let dir: string
let patchPath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcp-station-patch-'))
  patchPath = join(dir, 'cordis.patch.yml')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('parsePatchRows', () => {
  it('lists external MCP rows with their env refs and origin', () => {
    const rows = parsePatchRows(EXTERNAL_PATCH)
    expect(rows).toHaveLength(1)
    const github = rows[0]!
    expect(github.serverName).toBe('github')
    expect(github.origin).toBe('external')
    expect(github.transport).toBe('stdio')
    expect(github.command).toBe('npx')
    expect(github.args).toEqual(['-y', '@modelcontextprotocol/server-github'])
    expect(github.env).toEqual({ GITHUB_TOKEN: 'env:GITHUB_TOKEN' })
    expect(github.enabled).toBe(true)
  })

  it('returns nothing for an empty document', () => {
    expect(parsePatchRows('')).toEqual([])
    expect(parsePatchRows('[]\n')).toEqual([])
  })

  it('throws on malformed YAML', () => {
    expect(() => parsePatchRows('- a\n b: [\n')).toThrow()
  })
})

describe('upsertManagedBlock', () => {
  it('appends an insert block and preserves every external byte', () => {
    const next = upsertManagedBlock(EXTERNAL_PATCH, [PLAYWRIGHT])
    expect(next.startsWith(EXTERNAL_PATCH)).toBe(true)
    expect(next).toContain(MANAGED_BLOCK_BEGIN)
    expect(next).toContain(MANAGED_BLOCK_END)
    expect(next).toContain('- insert:')
    expect(next).toContain('serverName: playwright')
    const rows = parsePatchRows(next)
    expect(rows).toHaveLength(2)
    const station = rows.find((row) => row.serverName === 'playwright')!
    expect(station.origin).toBe('station')
    expect(station.command).toBe('npx')
    expect(rows.find((row) => row.serverName === 'github')?.origin).toBe('external')
  })

  it('adds the block to an empty file and to the empty array template', () => {
    const fromEmpty = upsertManagedBlock('', [PLAYWRIGHT])
    expect(fromEmpty.startsWith(MANAGED_BLOCK_BEGIN)).toBe(true)
    expect(parsePatchRows(fromEmpty)).toHaveLength(1)
    const fromTemplate = upsertManagedBlock('[]\n', [PLAYWRIGHT])
    expect(fromTemplate.startsWith(MANAGED_BLOCK_BEGIN)).toBe(true)
    expect(fromTemplate.trim().endsWith(MANAGED_BLOCK_END)).toBe(true)
  })

  it('keeps CRLF line endings outside the block', () => {
    const crlf = EXTERNAL_PATCH.replace(/\n/g, '\r\n')
    const next = upsertManagedBlock(crlf, [PLAYWRIGHT])
    expect(next.slice(0, crlf.length)).toBe(crlf)
    expect(next).toContain('\r\n    - id: mcp-station-playwright')
  })

  it('removing every station row deletes the block and restores the external bytes', () => {
    const added = upsertManagedBlock(EXTERNAL_PATCH, [PLAYWRIGHT])
    const removed = removeManagedRow(added, 'playwright')
    expect(removed).toBe(EXTERNAL_PATCH)
    expect(removed).not.toContain(MANAGED_BLOCK_BEGIN)
  })

  it('never touches an external insert row', () => {
    const added = addManagedRow(EXTERNAL_INSERT_PATCH, PLAYWRIGHT)
    expect(added.startsWith(EXTERNAL_INSERT_PATCH)).toBe(true)
    const rows = parsePatchRows(added)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.serverName === 'gh-custom')?.origin).toBe('external')
    const removed = removeManagedRow(added, 'playwright')
    expect(removed).toBe(EXTERNAL_INSERT_PATCH)
  })

  it('rejects a half-written block', () => {
    const half = '# >>> dsh-mcp-station:begin\n' + EXTERNAL_PATCH
    expect(() => upsertManagedBlock(half, [PLAYWRIGHT])).toThrow()
    expect(() => parsePatchRows(half)).toThrow()
  })

  it('rejects duplicate server names', () => {
    const added = upsertManagedBlock(EXTERNAL_PATCH, [PLAYWRIGHT])
    expect(() => addManagedRow(added, PLAYWRIGHT)).toThrow(/已存在/)
    expect(() => upsertManagedBlock(added, [PLAYWRIGHT, PLAYWRIGHT])).toThrow(/重复/)
  })
})

describe('renderManagedRow / env references', () => {
  it('renders env:NAME as a !!js expression and round-trips it', () => {
    const github: ManagedRowInput = {
      serverName: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'env:GITHUB_TOKEN', LITERAL_PATH: '/tmp/memory file.json' },
    }
    const lines = renderManagedRow(github)
    expect(lines.join('\n')).toContain('GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN')
    expect(lines.join('\n')).toContain("LITERAL_PATH: '/tmp/memory file.json'")
    const text = upsertManagedBlock(EXTERNAL_PATCH, [github])
    const parsed = parsePatchRows(text).find((row) => row.origin === 'station' && row.serverName === 'github')!
    expect(parsed.env).toEqual({ GITHUB_TOKEN: 'env:GITHUB_TOKEN', LITERAL_PATH: '/tmp/memory file.json' })
  })

  it('renders disabled only for disabled rows', () => {
    expect(renderManagedRow(PLAYWRIGHT).join('\n')).not.toContain('disabled')
    expect(renderManagedRow({ ...PLAYWRIGHT, enabled: false }).join('\n')).toContain('  disabled: true')
  })
})

describe('setManagedRowEnabled', () => {
  it('changes exactly one line and leaves the external prefix byte-identical', () => {
    const added = upsertManagedBlock(EXTERNAL_PATCH, [PLAYWRIGHT])
    const disabled = setManagedRowEnabled(added, 'playwright', false)
    const before = added.split('\n')
    const after = disabled.split('\n')
    expect(after.length).toBe(before.length + 1)
    const inserted = addedLineIndex(before, after)
    expect(inserted).toBeGreaterThanOrEqual(0)
    expect(after[inserted]!.trim()).toBe('disabled: true')
    expect(blockPrefix(disabled)).toBe(blockPrefix(added))
    expect(blockPrefix(disabled)).toBe(EXTERNAL_PATCH)
    const parsed = parsePatchRows(disabled).find((row) => row.serverName === 'playwright')!
    expect(parsed.enabled).toBe(false)
  })

  it('round-trips back to the enabled document', () => {
    const added = upsertManagedBlock(EXTERNAL_PATCH, [PLAYWRIGHT])
    const disabled = setManagedRowEnabled(added, 'playwright', false)
    const enabled = setManagedRowEnabled(disabled, 'playwright', true)
    expect(enabled).toBe(added)
  })

  it('leaves sibling station rows untouched', () => {
    const memory: ManagedRowInput = {
      serverName: 'memory',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: { MEMORY_FILE_PATH: '/tmp/memory.json' },
    }
    const added = upsertManagedBlock(EXTERNAL_PATCH, [PLAYWRIGHT, memory])
    const disabled = setManagedRowEnabled(added, 'playwright', false)
    expect(disabled).toContain('serverName: memory')
    expect(disabled).toContain("MEMORY_FILE_PATH: '/tmp/memory.json'")
    expect(parsePatchRows(disabled).filter((row) => row.origin === 'station')).toHaveLength(2)
  })
})

describe('readManagedBlock / inspectPatchText', () => {
  it('reports station rows and no foreign parts for a fresh block', () => {
    const added = upsertManagedBlock(EXTERNAL_PATCH, [PLAYWRIGHT])
    const view = readManagedBlock(added)
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0]!.serverName).toBe('playwright')
    expect(view.foreign.top).toEqual([])
    expect(view.foreign.members).toEqual([])
  })

  it('validates documents', () => {
    expect(inspectPatchText(EXTERNAL_PATCH).ok).toBe(true)
    expect(inspectPatchText('[]\n').ok).toBe(true)
    expect(inspectPatchText('a: 1\n').ok).toBe(false)
    expect(inspectPatchText('[]\n', { requireBlock: true }).ok).toBe(false)
    const added = upsertManagedBlock(EXTERNAL_PATCH, [PLAYWRIGHT])
    expect(inspectPatchText(added, { requireBlock: true })).toEqual({ ok: true, hasBlock: true })
  })
})


const EXTERNAL_HTTP_PATCH = [
  '# external HTTP MCP row with headers',
  '- insert:',
  '    - id: user-mcp-remote',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        serverName: remote',
  '        transport: streamable-http',
  '        url: https://example.com/mcp',
  '        headers:',
  '          Authorization: !!js process.env.MCP_TOKEN',
  '          X-Trace-Id: trace-literal',
  '',
].join('\n')

const HTTP_ROW: ManagedRowInput = {
  serverName: 'remote-http',
  transport: 'streamable-http',
  url: 'https://example.com/mcp',
  headers: {
    Authorization: 'env:MCP_TOKEN',
    'X-Api-Key': 'env:API_KEY',
    'X-Plain': 'literal value',
  },
}

describe('HTTP headers', () => {
  it('renders header env references and round-trips them', () => {
    const lines = renderManagedRow(HTTP_ROW).join('\n')
    expect(lines).toContain('headers:')
    expect(lines).toContain('Authorization: !!js process.env.MCP_TOKEN')
    expect(lines).toContain('X-Api-Key: !!js process.env.API_KEY')
    expect(lines).toContain("X-Plain: 'literal value'")
    const text = upsertManagedBlock(EXTERNAL_PATCH, [HTTP_ROW])
    const parsed = parsePatchRows(text).find((row) => row.origin === 'station' && row.serverName === 'remote-http')!
    expect(parsed.transport).toBe('streamable-http')
    expect(parsed.url).toBe('https://example.com/mcp')
    expect(parsed.headers).toEqual({
      Authorization: 'env:MCP_TOKEN',
      'X-Api-Key': 'env:API_KEY',
      'X-Plain': 'literal value',
    })
  })

  it('keeps headers byte-identical when a row is toggled', () => {
    const added = upsertManagedBlock(EXTERNAL_PATCH, [HTTP_ROW])
    const disabled = setManagedRowEnabled(added, 'remote-http', false)
    const enabled = setManagedRowEnabled(disabled, 'remote-http', true)
    expect(enabled).toBe(added)
    expect(blockPrefix(disabled)).toBe(EXTERNAL_PATCH)
  })

  it('parses external HTTP rows with headers', () => {
    const rows = parsePatchRows(EXTERNAL_HTTP_PATCH)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.transport).toBe('streamable-http')
    expect(rows[0]!.url).toBe('https://example.com/mcp')
    expect(rows[0]!.headers).toEqual({ Authorization: 'env:MCP_TOKEN', 'X-Trace-Id': 'trace-literal' })
    expect(rows[0]!.origin).toBe('external')
  })
})

describe('replaceManagedRow', () => {
  it('replaces one station row in place, keeping id and external bytes', () => {
    const added = upsertManagedBlock(EXTERNAL_PATCH, [PLAYWRIGHT])
    const updated = replaceManagedRow(added, {
      serverName: 'playwright',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--headless'],
      enabled: false,
    })
    expect(updated.startsWith(EXTERNAL_PATCH)).toBe(true)
    const rows = parsePatchRows(updated)
    expect(rows.filter((row) => row.origin === 'station')).toHaveLength(1)
    const station = rows.find((row) => row.serverName === 'playwright')!
    expect(station.args).toEqual(['-y', '@playwright/mcp@latest', '--headless'])
    expect(station.enabled).toBe(false)
    expect(readManagedBlock(updated).rows[0]!.id).toBe('mcp-station-playwright')
  })

  it('throws for an unknown station name', () => {
    const added = upsertManagedBlock(EXTERNAL_PATCH, [PLAYWRIGHT])
    expect(() => replaceManagedRow(added, { ...PLAYWRIGHT, serverName: 'nope' })).toThrow(/找不到/)
  })
})

describe('writePatchTextAtomic', () => {
  it('writes atomically and rotates at most three backups', async () => {
    await writeFile(patchPath, EXTERNAL_PATCH, 'utf8')
    let text = EXTERNAL_PATCH
    for (let index = 0; index < 4; index += 1) {
      text = upsertManagedBlock(text, [{ ...PLAYWRIGHT, enabled: index % 2 === 0 }])
      const result = await writePatchTextAtomic(patchPath, text, { requireBlock: true })
      expect(result.created).toBe(false)
      expect(result.backupPath).toBe(patchPath + '.bak')
      const onDisk = await readFile(patchPath, 'utf8')
      expect(onDisk).toBe(text)
    }
    const entries = await readdir(dir)
    expect(entries).toContain('cordis.patch.yml.bak')
    expect(entries).toContain('cordis.patch.yml.bak.1')
    expect(entries).toContain('cordis.patch.yml.bak.2')
    expect(entries).not.toContain('cordis.patch.yml.bak.3')
    expect(entries.filter((entry) => entry.includes('.tmp-'))).toEqual([])
  })

  it('refuses invalid text without touching the target file', async () => {
    await writeFile(patchPath, EXTERNAL_PATCH, 'utf8')
    await expect(writePatchTextAtomic(patchPath, 'not: [valid', {})).rejects.toThrow()
    expect(await readFile(patchPath, 'utf8')).toBe(EXTERNAL_PATCH)
    const entries = await readdir(dir)
    expect(entries.filter((entry) => entry.includes('.tmp-'))).toEqual([])
  })

  it('creates a missing file', async () => {
    const next = upsertManagedBlock('', [PLAYWRIGHT])
    const result = await writePatchTextAtomic(patchPath, next, { requireBlock: true })
    expect(result.created).toBe(true)
    expect(await readFile(patchPath, 'utf8')).toBe(next)
  })
})

describe('listInstalledServers', () => {
  it('merges station rows with catalog metadata and disabled state', async () => {
    await writeFile(patchPath, EXTERNAL_PATCH, 'utf8')
    let text = upsertManagedBlock(EXTERNAL_PATCH, [PLAYWRIGHT])
    await writeFile(patchPath, text, 'utf8')
    let servers = await listInstalledServers(patchPath)
    const playwright = servers.find((server) => server.serverName === 'playwright')!
    expect(playwright.origin).toBe('station')
    expect(playwright.presetId).toBe('playwright')
    expect(playwright.displayName?.zh).toContain('Playwright')
    expect(playwright.status).toBe('unknown')
    expect(servers.find((server) => server.serverName === 'github')?.origin).toBe('external')
    text = setManagedRowEnabled(text, 'playwright', false)
    await writeFile(patchPath, text, 'utf8')
    servers = await listInstalledServers(patchPath)
    expect(servers.find((server) => server.serverName === 'playwright')?.status).toBe('disabled')
  })

  it('returns [] for a missing file', async () => {
    expect(await listInstalledServers(join(dir, 'missing.yml'))).toEqual([])
  })
})
