import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApiHandler } from '../src/api.ts'
import { Market } from '../src/market.ts'
import { probeStdio, resolveEnvValues } from '../src/mcp/probe.ts'
import {
  addManagedRow,
  inspectPatchText,
  parsePatchRows,
  readPatchText,
  writePatchTextAtomic,
} from '../src/patch.ts'
import type { PatchRow } from '../src/patch.ts'
import type { ProbeResult } from '../src/shared/types.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url))

const EXTERNAL_ROW = [
  '# a hand-written MCP row outside the managed block',
  '- insert:',
  '    - id: user-mcp-github',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        serverName: github',
  '        transport: stdio',
  '        command: npx',
  '        args: ["-y", "@modelcontextprotocol/server-github"]',
  '',
].join('\n')

let root: string
let home: string
let patchPath: string
let server: ReturnType<typeof createServer>
let base = ''

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: any }> {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(headers ?? {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, json: text === '' ? null : JSON.parse(text) }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcp-station-api-'))
  home = join(root, 'dsh-home')
  const profileDir = join(home, 'profiles', 'test')
  await mkdir(profileDir, { recursive: true })
  await writeFile(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-test', private: true, dsh: { profile: { bundles: [] } } }, null, 2) + '\n',
    'utf8',
  )
  patchPath = join(profileDir, 'cordis.patch.yml')
  await writeFile(patchPath, EXTERNAL_ROW, 'utf8')
  const handler = makeApiHandler(
    undefined as never,
    {
      dshHome: home,
      profile: 'test',
      workspace: root,
      probeTimeoutMs: 5000,
      maxBodyBytes: 64 * 1024,
    },
    {
      // No external network: the registry endpoint is unreachable in unit tests.
      market: new Market({ dshHome: home, registryBaseUrl: 'http://127.0.0.1:1/v0/servers', requestTimeoutMs: 500 }),
      // Preset installs are probed with a deterministic fake; fixture rows use the real probe.
      probeRow: async (row: PatchRow): Promise<ProbeResult> => {
        if (row.serverName.startsWith('playwright')) {
          return { ok: true, tools: [{ name: 'browser_navigate', dangerous: false }], toolCount: 1, latencyMs: 7 }
        }
        const env = resolveEnvValues(row.env)
        const outcome = await probeStdio({
          command: row.command ?? '',
          args: row.args ?? [],
          env,
          timeoutMs: 5000,
        })
        return {
          ok: outcome.ok,
          tools: outcome.tools,
          toolCount: outcome.tools.length,
          latencyMs: outcome.latencyMs,
          ...(outcome.error === undefined ? {} : { error: outcome.error }),
        }
      },
    },
  )
  server = createServer((req, res) => {
    void handler(req, res)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  base = 'http://127.0.0.1:' + String(address.port) + '/mcp-station/api'
})

afterAll(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  await rm(root, { recursive: true, force: true })
})

describe('MCP Station API', () => {
  it('serves status with the isolated profile', async () => {
    const { status, json } = await api('GET', '/status')
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.data.profile).toBe('test')
    expect(json.data.patchPath).toBe(patchPath)
    expect(Array.isArray(json.data.warnings)).toBe(true)
  })

  it('serves catalog and servers with the external row read-only', async () => {
    const catalog = await api('GET', '/catalog')
    expect(catalog.status).toBe(200)
    expect(catalog.json.data.catalog.presets.length).toBeGreaterThan(0)
    const servers = catalog.json.data.servers as { serverName: string; origin: string }[]
    expect(servers.map((item) => item.serverName)).toEqual(['github'])
    expect(servers[0]!.origin).toBe('external')
    const list = await api('GET', '/servers')
    expect(list.json.data.servers).toHaveLength(1)
  })

  it('runs doctor checks including patch parsing', async () => {
    const { status, json } = await api('GET', '/doctor')
    expect(status).toBe(200)
    const ids = (json.data.checks as { id: string }[]).map((check) => check.id)
    expect(ids).toContain('patch-parse')
    expect(ids).toContain('managed-block')
    expect(ids).toContain('catalog')
    const patchCheck = (json.data.checks as { id: string; ok: boolean }[]).find((check) => check.id === 'patch-parse')
    expect(patchCheck?.ok).toBe(true)
  })

  it('installs a preset into the managed block and skips a conflicting serverName', async () => {
    const first = await api('POST', '/servers/install', { presetId: 'playwright' })
    expect(first.status).toBe(200)
    expect(first.json.data.server.serverName).toBe('playwright')
    expect(first.json.data.server.origin).toBe('station')
    expect(first.json.data.server.presetId).toBe('playwright')
    const second = await api('POST', '/servers/install', { presetId: 'playwright' })
    expect(second.status).toBe(409)
    expect(second.json.error.code).toBe('conflict')
    expect(second.json.error.message).toContain('serverName')
    const text = (await readPatchText(patchPath)).text
    expect(text.startsWith(EXTERNAL_ROW)).toBe(true)
    expect(inspectPatchText(text, { requireBlock: true }).ok).toBe(true)
    expect(parsePatchRows(text)).toHaveLength(2)
  })

  it('rejects an explicit duplicate serverName with 409', async () => {
    const { status, json } = await api('POST', '/servers/install', { presetId: 'playwright', serverName: 'playwright' })
    expect(status).toBe(409)
    expect(json.ok).toBe(false)
    expect(json.error.code).toBe('conflict')
  })

  it('toggles a station row on disk and leaves external rows read-only', async () => {
    const toggled = await api('POST', '/servers/toggle', { serverName: 'playwright', enabled: false })
    expect(toggled.status).toBe(200)
    expect(toggled.json.data.server.status).toBe('disabled')
    const text = (await readPatchText(patchPath)).text
    const station = parsePatchRows(text).find((row) => row.serverName === 'playwright')!
    expect(station.enabled).toBe(false)
    const external = await api('POST', '/servers/toggle', { serverName: 'github', enabled: false })
    expect(external.status).toBe(403)
    expect(external.json.error.code).toBe('read-only')
  })

  it('refuses cross-origin mutations', async () => {
    const { status, json } = await api(
      'POST',
      '/servers/toggle',
      { serverName: 'playwright', enabled: true },
      { origin: 'http://evil.example' },
    )
    expect(status).toBe(403)
    expect(json.error.code).toBe('forbidden')
  })

  it('maps unknown presets and malformed bodies to 404/400', async () => {
    const unknown = await api('POST', '/servers/install', { presetId: 'nope' })
    expect(unknown.status).toBe(404)
    const response = await fetch(base + '/servers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('invalid-json')
  })

  it('probes and smoke-tests a stdio server through the API', async () => {
    const text = (await readPatchText(patchPath)).text
    const next = addManagedRow(text, {
      serverName: 'fake',
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE],
    })
    await writePatchTextAtomic(patchPath, next, { requireBlock: true })
    const tested = await api('POST', '/servers/test', { serverName: 'fake' })
    expect(tested.status).toBe(200)
    expect(tested.json.data.result.ok).toBe(true)
    expect(tested.json.data.result.toolCount).toBe(5)
    const smoked = await api('POST', '/servers/smoke', {
      serverName: 'fake',
      tool: 'echo',
      args: { text: 'hi' },
    })
    expect(smoked.status).toBe(200)
    expect(smoked.json.data.result.ok).toBe(true)
    expect(smoked.json.data.result.output).toContain('echo:hi')
  })

  it('deletes a station row and keeps the profile parseable', async () => {
    const removed = await api('DELETE', '/servers?name=playwright')
    expect(removed.status).toBe(200)
    expect(removed.json.data.removed).toBe(true)
    const missing = await api('DELETE', '/servers?name=does-not-exist')
    expect(missing.status).toBe(404)
    const text = (await readFile(patchPath, 'utf8')) as string
    expect(inspectPatchText(text, { requireBlock: true }).ok).toBe(true)
    expect(parsePatchRows(text).some((row) => row.serverName === 'playwright')).toBe(false)
  })

  it('returns 404 for unknown GET routes', async () => {
    const { status, json } = await api('GET', '/nope')
    expect(status).toBe(404)
    expect(json.error.code).toBe('not-found')
  })
})
describe('custom servers, import and install-with-test', () => {
  it('creates a custom stdio server', async () => {
    const created = await api('POST', '/servers/custom', {
      serverName: 'custom-echo',
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE],
      enabled: true,
    })
    expect(created.status).toBe(200)
    const server = created.json.data.server
    expect(server.serverName).toBe('custom-echo')
    expect(server.origin).toBe('station')
    expect(server.transport).toBe('stdio')
    expect(server.status).toBe('unknown')
    const text = (await readPatchText(patchPath)).text
    const row = parsePatchRows(text).find((item) => item.serverName === 'custom-echo')!
    expect(row.origin).toBe('station')
    expect(row.command).toBe(process.execPath)
    expect(row.args).toEqual([FIXTURE])
  })

  it('validates custom create bodies and duplicate names', async () => {
    const duplicate = await api('POST', '/servers/custom', {
      serverName: 'custom-echo',
      transport: 'stdio',
      command: 'node',
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.json.error.code).toBe('conflict')
    const badName = await api('POST', '/servers/custom', { serverName: 'bad name!', transport: 'stdio', command: 'node' })
    expect(badName.status).toBe(400)
    const noTransport = await api('POST', '/servers/custom', { serverName: 'no-transport', command: 'node' })
    expect(noTransport.status).toBe(400)
    const noCommand = await api('POST', '/servers/custom', { serverName: 'no-command', transport: 'stdio' })
    expect(noCommand.status).toBe(400)
    const badUrl = await api('POST', '/servers/custom', {
      serverName: 'bad-url',
      transport: 'streamable-http',
      url: 'not a url',
    })
    expect(badUrl.status).toBe(400)
  })

  it('creates an HTTP custom server with header env references', async () => {
    const created = await api('POST', '/servers/custom', {
      serverName: 'custom-http',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'env:MCP_TOKEN', 'X-Trace': 'literal-trace' },
      enabled: false,
    })
    expect(created.status).toBe(200)
    const server = created.json.data.server
    expect(server.transport).toBe('streamable-http')
    expect(server.status).toBe('disabled')
    expect(server.headers).toEqual({ Authorization: 'env:MCP_TOKEN', 'X-Trace': 'literal-trace' })
    const text = (await readPatchText(patchPath)).text
    expect(text).toContain('Authorization: !!js process.env.MCP_TOKEN')
    expect(text).toContain("X-Trace: literal-trace")
  })

  it('updates a custom server in place and supports clearing env/headers', async () => {
    const updated = await api('POST', '/servers/custom/update', {
      serverName: 'custom-echo',
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE, '--stderr'],
      env: { MCP_STATION_TEST: 'ok' },
    })
    expect(updated.status).toBe(200)
    const server = updated.json.data.server
    expect(server.serverName).toBe('custom-echo')
    expect(server.args).toEqual([FIXTURE, '--stderr'])
    expect(server.env).toEqual({ MCP_STATION_TEST: 'ok' })
    const text = (await readPatchText(patchPath)).text
    const rows = parsePatchRows(text).filter((item) => item.origin === 'station')
    expect(rows.filter((item) => item.serverName === 'custom-echo')).toHaveLength(1)
    expect(rows.find((item) => item.serverName === 'custom-echo')!.id).toBe('mcp-station-custom-echo')
    const cleared = await api('POST', '/servers/custom/update', {
      serverName: 'custom-echo',
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE],
    })
    expect(cleared.status).toBe(200)
    expect(cleared.json.data.server.env).toBeUndefined()
    const httpCleared = await api('POST', '/servers/custom/update', {
      serverName: 'custom-http',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
    })
    expect(httpCleared.status).toBe(200)
    expect(httpCleared.json.data.server.headers).toBeUndefined()
    expect(httpCleared.json.data.server.status).toBe('disabled')
    const missing = await api('POST', '/servers/custom/update', {
      serverName: 'nope',
      transport: 'stdio',
      command: 'node',
    })
    expect(missing.status).toBe(404)
    const external = await api('POST', '/servers/custom/update', {
      serverName: 'github',
      transport: 'stdio',
      command: 'node',
    })
    expect(external.status).toBe(403)
    expect(external.json.error.code).toBe('read-only')
  })

  it('imports Claude/Cursor mcpServers and skips invalid or duplicate entries', async () => {
    const claude = {
      mcpServers: {
        'import-a': {
          command: process.execPath,
          args: [FIXTURE],
          env: { MCP_STATION_TEST: 'env:MCP_STATION_TEST' },
          unknownField: 'ignored',
        },
        'import-b': {
          type: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'env:MCP_TOKEN' },
        },
        'import-d': { command: 'node' },
        'bad name!': { command: 'node' },
        github: { command: 'npx' },
        'import-sse': { type: 'sse', url: 'https://example.com/sse' },
        'import-broken': { args: ['x'] },
      },
    }
    const imported = await api('POST', '/servers/import', { json: JSON.stringify(claude) })
    expect(imported.status).toBe(200)
    const names = (imported.json.data.imported as { serverName: string }[]).map((item) => item.serverName)
    expect(names).toEqual(['import-a', 'import-b', 'import-d'])
    const a = (imported.json.data.imported as { serverName: string; env?: Record<string, string> }[]).find(
      (item) => item.serverName === 'import-a',
    )!
    expect(a.env).toEqual({ MCP_STATION_TEST: 'env:MCP_STATION_TEST' })
    const b = (imported.json.data.imported as { serverName: string; headers?: Record<string, string> }[]).find(
      (item) => item.serverName === 'import-b',
    )!
    expect(b.headers).toEqual({ Authorization: 'env:MCP_TOKEN' })
    const skipped = imported.json.data.skipped as { name: string; reason: string }[]
    const skippedNames = skipped.map((item) => item.name)
    expect(skippedNames).toContain('bad name!')
    expect(skippedNames).toContain('github')
    expect(skippedNames).toContain('import-sse')
    expect(skippedNames).toContain('import-broken')
    expect(skipped.find((item) => item.name === 'github')?.reason).toContain('已存在')
    expect(skipped.find((item) => item.name === 'import-sse')?.reason).toContain('SSE')
    const text = (await readPatchText(patchPath)).text
    expect(text).toContain('serverName: import-a')
    expect(text).toContain('Authorization: !!js process.env.MCP_TOKEN')
    expect(parsePatchRows(text).filter((item) => item.serverName.startsWith('import-'))).toHaveLength(3)
  })

  it('imports a servers array and skips duplicate names inside the payload', async () => {
    const arrayImport = await api('POST', '/servers/import', {
      json: JSON.stringify({
        servers: [
          { name: 'array-a', command: process.execPath, args: [FIXTURE] },
          { serverName: 'array-b', url: 'https://example.com/mcp' },
          { name: 'array-a', command: 'node' },
        ],
      }),
    })
    expect(arrayImport.status).toBe(200)
    const names = (arrayImport.json.data.imported as { serverName: string }[]).map((item) => item.serverName)
    expect(names).toEqual(['array-a', 'array-b'])
    const skipped = arrayImport.json.data.skipped as { name: string; reason: string }[]
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.name).toBe('array-a')
  })

  it('rejects malformed import payloads', async () => {
    const nonString = await api('POST', '/servers/import', { json: 42 })
    expect(nonString.status).toBe(400)
    const badJson = await api('POST', '/servers/import', { json: '{nope' })
    expect(badJson.status).toBe(400)
    expect(badJson.json.error.code).toBe('invalid-json')
    const wrongShape = await api('POST', '/servers/import', { json: JSON.stringify({ foo: 1 }) })
    expect(wrongShape.status).toBe(400)
    expect(wrongShape.json.error.code).toBe('invalid-import')
  })

  it('probes after install when test is true and reuses the probe cache', async () => {
    const installed = await api('POST', '/servers/install', { presetId: 'playwright', test: true })
    expect(installed.status).toBe(200)
    const server = installed.json.data.server
    expect(server.serverName).toBe('playwright')
    expect(server.status).toBe('connected')
    expect(server.toolCount).toBe(1)
    expect(server.tools[0].name).toBe('browser_navigate')
    expect(typeof server.latencyMs).toBe('number')
    expect(typeof server.lastCheckedAt).toBe('string')
    const list = await api('GET', '/servers')
    const cached = (list.json.data.servers as { serverName: string; status: string }[]).find(
      (item) => item.serverName === 'playwright',
    )!
    expect(cached.status).toBe('connected')
    const invalid = await api('POST', '/servers/install', { presetId: 'playwright', test: 'yes' })
    expect(invalid.status).toBe(400)
  })
})

