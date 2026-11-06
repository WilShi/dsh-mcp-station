import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApiHandler } from '../src/api.ts'
import {
  addManagedRow,
  inspectPatchText,
  parsePatchRows,
  readPatchText,
  writePatchTextAtomic,
} from '../src/patch.ts'

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
  const handler = makeApiHandler(undefined as never, {
    dshHome: home,
    profile: 'test',
    workspace: root,
    probeTimeoutMs: 5000,
    maxBodyBytes: 64 * 1024,
  })
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

  it('installs a preset into the managed block with a unique name', async () => {
    const first = await api('POST', '/servers/install', { presetId: 'playwright' })
    expect(first.status).toBe(200)
    expect(first.json.data.server.serverName).toBe('playwright')
    expect(first.json.data.server.origin).toBe('station')
    expect(first.json.data.server.presetId).toBe('playwright')
    const second = await api('POST', '/servers/install', { presetId: 'playwright' })
    expect(second.json.data.server.serverName).toBe('playwright-2')
    const text = (await readPatchText(patchPath)).text
    expect(text.startsWith(EXTERNAL_ROW)).toBe(true)
    expect(inspectPatchText(text, { requireBlock: true }).ok).toBe(true)
    expect(parsePatchRows(text)).toHaveLength(3)
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
    const removed = await api('DELETE', '/servers?name=playwright-2')
    expect(removed.status).toBe(200)
    expect(removed.json.data.removed).toBe(true)
    const missing = await api('DELETE', '/servers?name=does-not-exist')
    expect(missing.status).toBe(404)
    const text = (await readFile(patchPath, 'utf8')) as string
    expect(inspectPatchText(text, { requireBlock: true }).ok).toBe(true)
    expect(parsePatchRows(text).some((row) => row.serverName === 'playwright-2')).toBe(false)
  })

  it('returns 404 for unknown GET routes', async () => {
    const { status, json } = await api('GET', '/nope')
    expect(status).toBe(404)
    expect(json.error.code).toBe('not-found')
  })
})
