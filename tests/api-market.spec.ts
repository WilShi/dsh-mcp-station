import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApiHandler } from '../src/api.ts'
import { Market } from '../src/market.ts'
import type { CatalogPreset } from '../src/shared/types.ts'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function localized(value: string): { zh: string; en: string } {
  return { zh: value, en: value }
}

const API_STDIO: CatalogPreset = {
  id: 'api-stdio',
  serverName: 'api-stdio',
  displayName: localized('API Stdio'),
  tagline: localized('Stdio preset from a custom source'),
  description: localized('A stdio preset'),
  category: 'dev',
  transport: 'stdio',
  command: 'node',
  args: ['api-server.js'],
  env: { GREETING: '{{greeting}}' },
  inputs: [
    {
      key: 'greeting',
      label: localized('Greeting'),
      description: localized('Greeting text'),
      kind: 'text',
      required: false,
      default: 'hello',
    },
  ],
  risk: { level: 'low', reasons: [] },
}

const API_HTTP: CatalogPreset = {
  id: 'api-http',
  serverName: 'api-http',
  displayName: localized('API HTTP'),
  tagline: localized('HTTP preset from a custom source'),
  description: localized('A streamable HTTP preset'),
  category: 'dev',
  transport: 'streamable-http',
  url: 'https://api.example/mcp',
  headers: { Authorization: 'env:MCP_TOKEN' },
  risk: { level: 'medium', reasons: [] },
}

const SOURCE_DOC = JSON.stringify({ version: 1, name: 'Team Source', presets: [API_STDIO, API_HTTP] })

const REGISTRY_DOC = {
  servers: [
    {
      server: {
        name: 'io.github.acme/weather',
        title: 'Weather MCP',
        description: 'Weather tools',
        packages: [
          {
            registryType: 'npm',
            identifier: '@acme/weather-mcp',
            runtimeHint: 'npx',
            transport: { type: 'stdio' },
            runtimeArguments: [{ type: 'positional', value: '-y' }],
            environmentVariables: [{ name: 'WEATHER_API_KEY', description: 'Key', isSecret: true, isRequired: true }],
          },
        ],
      },
    },
    {
      server: {
        name: 'io.github.acme/weather-remote',
        description: 'Remote weather',
        remotes: [{ type: 'streamable-http', url: 'https://weather.example/mcp' }],
      },
    },
  ],
  metadata: { nextCursor: 'registry-next', count: 2 },
}

let root: string
let home: string
let patchPath: string
let sourceServer: ReturnType<typeof createServer>
let registryServer: ReturnType<typeof createServer>
let sourceBase = ''
let registryBase = ''
let registryMode: 'ok' | 'fail' = 'ok'
let apiServer: ReturnType<typeof createServer>
let base = ''

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, json: text === '' ? null : JSON.parse(text) }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcp-station-api-market-'))
  home = join(root, 'dsh-home')
  const profileDir = join(home, 'profiles', 'test')
  await mkdir(profileDir, { recursive: true })
  await writeFile(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-test', private: true, dsh: { profile: { bundles: [] } } }, null, 2) + '\n',
    'utf8',
  )
  patchPath = join(profileDir, 'cordis.patch.yml')
  await writeFile(patchPath, '# empty profile patch\n[]\n', 'utf8')

  sourceServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const send = (status: number, body: string): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(body)
    }
    if (url.pathname === '/valid.json') {
      send(200, SOURCE_DOC)
      return
    }
    if (url.pathname === '/broken.json') {
      send(200, '{not json')
      return
    }
    send(404, 'not found')
  })
  await new Promise<void>((resolve) => {
    sourceServer.listen(0, '127.0.0.1', () => resolve())
  })
  sourceBase = 'http://127.0.0.1:' + String((sourceServer.address() as AddressInfo).port)

  registryServer = createServer((req, res) => {
    if (registryMode === 'fail') {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('registry down')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(REGISTRY_DOC))
  })
  await new Promise<void>((resolve) => {
    registryServer.listen(0, '127.0.0.1', () => resolve())
  })
  registryBase = 'http://127.0.0.1:' + String((registryServer.address() as AddressInfo).port) + '/v0/servers'

  const market = new Market({
    dshHome: home,
    requestTimeoutMs: 500,
    cacheTtlMs: 60_000,
    registryBaseUrl: registryBase,
    registryCacheTtlMs: 60_000,
  })
  const handler = makeApiHandler(
    undefined as never,
    { dshHome: home, profile: 'test', workspace: root, probeTimeoutMs: 5000, maxBodyBytes: 128 * 1024 },
    {
      market,
      probeRow: async () => ({ ok: true, tools: [{ name: 'echo' }], toolCount: 1, latencyMs: 3 }),
    },
  )
  apiServer = createServer((req, res) => {
    void handler(req, res)
  })
  await new Promise<void>((resolve) => {
    apiServer.listen(0, '127.0.0.1', () => resolve())
  })
  base = 'http://127.0.0.1:' + String((apiServer.address() as AddressInfo).port) + '/mcp-station/api'
})

afterAll(async () => {
  for (const server of [apiServer, sourceServer, registryServer]) {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }
  await rm(root, { recursive: true, force: true })
})

describe('market sources API', () => {
  it('lists builtin and registry sources and reports the runtime plugin version', async () => {
    const sources = await api('GET', '/sources')
    expect(sources.status).toBe(200)
    const ids = (sources.json.data.sources as { id: string }[]).map((source) => source.id)
    expect(ids).toEqual(['builtin', 'mcp-registry'])
    const registry = (sources.json.data.sources as { id: string; builtin: boolean; status: string }[])[1]!
    expect(registry.builtin).toBe(true)
    expect(registry.status).toBe('unknown')
    const status = await api('GET', '/status')
    const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version: string }
    expect(status.json.data.pluginVersion).toBe(pkg.version)
  })

  it('creates, refreshes and merges a custom JSON source', async () => {
    const created = await api('POST', '/sources', { name: 'Team', url: sourceBase + '/valid.json' })
    expect(created.status).toBe(200)
    expect(created.json.data.source.id).toBe('team')
    expect(created.json.data.source.status).toBe('ok')
    expect(created.json.data.source.entryCount).toBe(2)
    const invalid = await api('POST', '/sources', { name: 'Bad', url: 'not a url' })
    expect(invalid.status).toBe(400)
    const builtin = await api('POST', '/sources', { id: 'builtin', url: sourceBase + '/valid.json' })
    expect(builtin.status).toBe(400)
    const refreshed = await api('POST', '/sources/refresh', { id: 'team' })
    expect(refreshed.status).toBe(200)
    const team = (refreshed.json.data.sources as { id: string; status: string; entryCount: number }[]).find(
      (source) => source.id === 'team',
    )!
    expect(team.status).toBe('ok')
    expect(team.entryCount).toBe(2)
    const catalog = await api('GET', '/catalog')
    expect(catalog.status).toBe(200)
    const presets = catalog.json.data.catalog.presets as { uid: string; sourceId: string; sourceName: string }[]
    expect(presets.map((preset) => preset.uid)).toContain('team:api-stdio')
    expect(presets.map((preset) => preset.uid)).toContain('team:api-http')
    expect(presets.find((preset) => preset.uid === 'team:api-http')?.sourceName).toBe('Team')
    expect((catalog.json.data.sources as unknown[]).length).toBeGreaterThanOrEqual(3)
  })

  it('browses local sources with search and pagination', async () => {
    const page = await api('GET', '/market?source=team&search=api&limit=1')
    expect(page.status).toBe(200)
    const items = page.json.data.items as { uid: string; sourceId: string; displayName: { en: string }; transport: string }[]
    expect(items).toHaveLength(1)
    expect(items[0]!.sourceId).toBe('team')
    expect(items[0]!.uid.startsWith('team:')).toBe(true)
    expect(items[0]!.transport).toBe('stdio')
    expect(typeof page.json.data.nextCursor).toBe('string')
    const next = await api('GET', '/market?source=team&search=api&limit=1&cursor=' + encodeURIComponent(page.json.data.nextCursor))
    expect(next.status).toBe(200)
    expect((next.json.data.items as unknown[])).toHaveLength(1)
    expect(next.json.data.nextCursor).toBeUndefined()
    const tooBig = await api('GET', '/market?limit=101')
    expect(tooBig.status).toBe(400)
    const unknown = await api('GET', '/market?source=nope')
    expect(unknown.status).toBe(404)
  })

  it('aggregates local and registry items without a source filter', async () => {
    const page = await api('GET', '/market?limit=100')
    expect(page.status).toBe(200)
    const items = page.json.data.items as { sourceId: string }[]
    const sources = new Set(items.map((item) => item.sourceId))
    expect(sources.has('builtin')).toBe(true)
    expect(sources.has('team')).toBe(true)
    expect(sources.has('mcp-registry')).toBe(true)
    expect(page.json.data.nextCursor).toBeTruthy()
    expect(page.json.data.warnings).toBeUndefined()
  })

  it('installs presets from a custom source with sourceId', async () => {
    const installed = await api('POST', '/servers/install', { presetId: 'api-http', sourceId: 'team', test: true })
    expect(installed.status).toBe(200)
    const server = installed.json.data.server
    expect(server.serverName).toBe('api-http')
    expect(server.sourceId).toBe('team')
    expect(server.sourceName).toBe('Team')
    expect(server.headers).toEqual({ Authorization: 'env:MCP_TOKEN' })
    expect(server.status).toBe('connected')
    const conflict = await api('POST', '/servers/install', { presetId: 'api-http', sourceId: 'team' })
    expect(conflict.status).toBe(409)
    expect(conflict.json.error.code).toBe('conflict')
    const stdio = await api('POST', '/servers/install', {
      presetId: 'api-stdio',
      sourceId: 'team',
      values: { greeting: 'hey' },
    })
    expect(stdio.status).toBe(200)
    expect(stdio.json.data.server.env).toEqual({ GREETING: 'hey' })
    const text = await readFile(patchPath, 'utf8')
    expect(text).toContain('serverName: api-http')
    expect(text).toContain('Authorization: !!js process.env.MCP_TOKEN')
  })

  it('browses the official registry and installs one of its items', async () => {
    const page = await api('GET', '/market?source=mcp-registry&search=weather')
    expect(page.status).toBe(200)
    const items = page.json.data.items as {
      id: string
      sourceId: string
      command?: string
      args?: string[]
      inputs?: { key: string; kind: string }[]
    }[]
    expect(items).toHaveLength(2)
    expect(items[0]!.sourceId).toBe('mcp-registry')
    expect(items[0]!.command).toBe('npx')
    expect(items[0]!.args).toEqual(['-y', '@acme/weather-mcp'])
    expect(items[0]!.inputs?.[0]).toMatchObject({ key: 'WEATHER_API_KEY', kind: 'secret' })
    expect(page.json.data.nextCursor).toBe('registry-next')
    const registrySource = (page.json.data.sources as { id: string; status: string; entryCount: number }[]).find(
      (source) => source.id === 'mcp-registry',
    )!
    expect(registrySource.status).toBe('ok')
    expect(registrySource.entryCount).toBe(2)
    const installed = await api('POST', '/servers/install', {
      presetId: items[0]!.id,
      sourceId: 'mcp-registry',
      values: { WEATHER_API_KEY: 'secret-key' },
    })
    expect(installed.status).toBe(200)
    const server = installed.json.data.server
    expect(server.serverName).toBe('weather')
    expect(server.sourceId).toBe('mcp-registry')
    expect(server.command).toBe('npx')
    expect(server.env).toEqual({ WEATHER_API_KEY: 'secret-key' })
  })

  it('degrades when the registry is down', async () => {
    registryMode = 'fail'
    try {
      const explicit = await api('GET', '/market?source=mcp-registry&search=weather-down')
      expect(explicit.status).toBe(502)
      expect(explicit.json.error.code).toBe('registry-upstream')
      const aggregate = await api('GET', '/market?limit=100&search=api')
      expect(aggregate.status).toBe(200)
      expect((aggregate.json.data.items as unknown[]).length).toBeGreaterThan(0)
      const warnings = aggregate.json.data.warnings as string[]
      expect(warnings.some((warning) => warning.includes('注册表'))).toBe(true)
      const registry = (aggregate.json.data.sources as { id: string; status: string }[]).find(
        (source) => source.id === 'mcp-registry',
      )!
      expect(registry.status).toBe('error')
    } finally {
      registryMode = 'ok'
    }
  })

  it('keeps other sources when a custom source returns bad JSON', async () => {
    const created = await api('POST', '/sources', { name: 'Broken', url: sourceBase + '/broken.json' })
    expect(created.status).toBe(200)
    const refreshed = await api('POST', '/sources/refresh', { id: 'broken' })
    expect(refreshed.status).toBe(200)
    const broken = (refreshed.json.data.sources as { id: string; status: string; error?: string }[]).find(
      (source) => source.id === 'broken',
    )!
    expect(broken.status).toBe('error')
    expect(broken.error).toContain('JSON')
    const catalog = await api('GET', '/catalog')
    expect(catalog.status).toBe(200)
    expect((catalog.json.data.catalog.presets as { uid: string }[]).some((preset) => preset.uid === 'team:api-stdio')).toBe(true)
  })

  it('stores displayLanguage settings', async () => {
    const defaults = await api('GET', '/settings')
    expect(defaults.status).toBe(200)
    expect(defaults.json.data.settings.displayLanguage).toBe('auto')
    const saved = await api('POST', '/settings', { displayLanguage: 'zh' })
    expect(saved.status).toBe(200)
    expect(saved.json.data.settings.displayLanguage).toBe('zh')
    const reloaded = await api('GET', '/settings')
    expect(reloaded.json.data.settings.displayLanguage).toBe('zh')
    const partial = await api('POST', '/settings', {})
    expect(partial.status).toBe(200)
    expect(partial.json.data.settings.displayLanguage).toBe('zh')
    const invalid = await api('POST', '/settings', { displayLanguage: 'fr' })
    expect(invalid.status).toBe(400)
  })

  it('deletes custom sources but keeps builtin sources read-only', async () => {
    const removed = await api('DELETE', '/sources?id=team')
    expect(removed.status).toBe(200)
    expect(removed.json.data.removed).toBe(true)
    const builtin = await api('DELETE', '/sources?id=builtin')
    expect(builtin.status).toBe(400)
    const missing = await api('DELETE', '/sources?id=nope')
    expect(missing.status).toBe(200)
    expect(missing.json.data.removed).toBe(false)
    const catalog = await api('GET', '/catalog')
    expect(
      (catalog.json.data.catalog.presets as { uid: string }[]).some((preset) => preset.uid === 'team:api-stdio'),
    ).toBe(false)
  })
})
