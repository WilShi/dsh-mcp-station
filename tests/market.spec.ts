import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/catalog.ts'
import { Market, MarketError, BUILTIN_SOURCE_ID, BUILTIN_SOURCE_NAME } from '../src/market.ts'
import { REGISTRY_SOURCE_ID, REGISTRY_SOURCE_NAME } from '../src/market-registry.ts'
import type { CatalogPreset } from '../src/shared/types.ts'

function localized(value: string): { zh: string; en: string } {
  return { zh: value, en: value }
}

const PRESET_STDIO: CatalogPreset = {
  id: 'remote-echo',
  serverName: 'remote-echo',
  displayName: localized('Remote Echo'),
  tagline: localized('Echo tools'),
  description: localized('Remote echo MCP'),
  category: 'dev',
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
  env: { GREETING: '{{greeting}}' },
  inputs: [
    {
      key: 'greeting',
      label: localized('Greeting'),
      description: localized('Greeting text'),
      kind: 'text',
      required: false,
      default: 'hi',
    },
  ],
  risk: { level: 'low', reasons: [] },
}

const PRESET_HTTP: CatalogPreset = {
  id: 'remote-http',
  serverName: 'remote-http',
  displayName: localized('Remote HTTP'),
  tagline: localized('HTTP tools'),
  description: localized('Remote HTTP MCP'),
  category: 'dev',
  transport: 'streamable-http',
  url: 'https://remote.example/mcp',
  headers: { Authorization: 'env:MCP_TOKEN' },
  risk: { level: 'medium', reasons: [] },
}

function sourceDocument(presets: CatalogPreset[]): string {
  return JSON.stringify({ version: 1, name: 'Team Source', updated: '2026-11-07', presets })
}

let root: string
let server: ReturnType<typeof createServer>
let base = ''
let validPayload = sourceDocument([PRESET_STDIO, PRESET_HTTP])
const timers = new Set<NodeJS.Timeout>()

function newMarket(options: { cacheTtlMs?: number; requestTimeoutMs?: number; maxBytes?: number; now?: () => number } = {}): Market {
  return new Market({
    dshHome: join(root, 'home'),
    cacheTtlMs: options.cacheTtlMs ?? 60_000,
    requestTimeoutMs: options.requestTimeoutMs ?? 500,
    maxBytes: options.maxBytes ?? 64 * 1024,
    now: options.now,
  })
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const send = (status: number, body: string): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(body)
    }
    if (url.pathname === '/valid.json') {
      send(200, validPayload)
      return
    }
    if (url.pathname === '/broken.json') {
      send(200, '{not json')
      return
    }
    if (url.pathname === '/big.json') {
      send(200, 'x'.repeat(8192))
      return
    }
    if (url.pathname === '/slow.json') {
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (!res.writableEnded) send(200, validPayload)
      }, 600)
      timers.add(timer)
      return
    }
    send(404, 'not found')
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  base = 'http://127.0.0.1:' + String(address.port)
})

afterAll(async () => {
  for (const timer of timers) clearTimeout(timer)
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
})

beforeEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = await mkdtemp(join(tmpdir(), 'mcp-station-market-'))
  validPayload = sourceDocument([PRESET_STDIO, PRESET_HTTP])
})

describe('Market sources', () => {
  it('lists the builtin, registry and custom sources', async () => {
    const market = newMarket()
    const catalog = await loadCatalog()
    const sources = await market.listSources()
    expect(sources.map((source) => source.id)).toEqual([BUILTIN_SOURCE_ID, REGISTRY_SOURCE_ID])
    expect(sources[0]!.name).toBe(BUILTIN_SOURCE_NAME)
    expect(sources[0]!.builtin).toBe(true)
    expect(sources[0]!.status).toBe('ok')
    expect(sources[0]!.entryCount).toBe(catalog.presets.length)
    expect(sources[1]!.name).toBe(REGISTRY_SOURCE_NAME)
    expect(sources[1]!.builtin).toBe(true)
    expect(sources[1]!.status).toBe('unknown')
    expect(sources[1]!.entryCount).toBe(0)
  })

  it('creates, updates and deletes custom sources', async () => {
    const market = newMarket()
    const created = await market.saveSource({ name: 'Team', url: base + '/valid.json' })
    expect(created.id).toBe('team')
    expect(created.name).toBe('Team')
    expect(created.builtin).toBe(false)
    expect(created.enabled).toBe(true)
    expect(created.status).toBe('ok')
    expect(created.entryCount).toBe(2)
    let sources = await market.listSources()
    expect(sources.map((source) => source.id)).toContain('team')
    const updated = await market.saveSource({
      id: 'team',
      name: 'Team Two',
      enabled: false,
      language: 'zh',
      headers: { 'X-Token': 'literal' },
    })
    expect(updated.name).toBe('Team Two')
    expect(updated.enabled).toBe(false)
    expect(updated.status).toBe('disabled')
    expect(updated.language).toBe('zh')
    expect(updated.headers).toEqual({ 'X-Token': 'literal' })
    expect(await market.deleteSource('does-not-exist')).toBe(false)
    expect(await market.deleteSource('team')).toBe(true)
    sources = await market.listSources()
    expect(sources.map((source) => source.id)).not.toContain('team')
  })

  it('protects builtin and registry source ids', async () => {
    const market = newMarket()
    await expect(market.saveSource({ id: BUILTIN_SOURCE_ID, url: base + '/valid.json' })).rejects.toThrow(MarketError)
    await expect(market.saveSource({ id: REGISTRY_SOURCE_ID, url: base + '/valid.json' })).rejects.toThrow(MarketError)
    await expect(market.deleteSource(BUILTIN_SOURCE_ID)).rejects.toThrow(MarketError)
    await expect(market.deleteSource(REGISTRY_SOURCE_ID)).rejects.toThrow(MarketError)
    await expect(market.saveSource({ name: 'No Url' })).rejects.toMatchObject({ status: 400 })
    await expect(market.saveSource({ name: 'Bad Url', url: 'ftp://example.com/x' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('Remote JSON source fetch', () => {
  it('refreshes and merges source presets with sourceId/sourceName/uid', async () => {
    const market = newMarket()
    const source = await market.saveSource({ name: 'Team', url: base + '/valid.json' })
    const refreshed = await market.refreshSources(source.id)
    const team = refreshed.find((item) => item.id === 'team')!
    expect(team.status).toBe('ok')
    expect(team.entryCount).toBe(2)
    expect(typeof team.lastFetchedAt).toBe('string')
    expect(team.error).toBeUndefined()
    const merged = await market.catalog({ refresh: false })
    const ids = merged.catalog.presets.map((preset) => preset.uid)
    expect(ids).toContain('team:remote-echo')
    expect(ids).toContain('team:remote-http')
    const echo = merged.catalog.presets.find((preset) => preset.id === 'remote-echo')!
    expect(echo.sourceId).toBe('team')
    expect(echo.sourceName).toBe('Team')
    const http = merged.catalog.presets.find((preset) => preset.id === 'remote-http')!
    expect(http.headers).toEqual({ Authorization: 'env:MCP_TOKEN' })
    expect(merged.sources.find((item) => item.id === 'team')?.entryCount).toBe(2)
  })

  it('respects the ten minute style cache TTL until forced', async () => {
    let clock = 1000
    const market = newMarket({ cacheTtlMs: 1000, now: () => clock })
    const source = await market.saveSource({ name: 'Team', url: base + '/valid.json' })
    await market.refreshSources(source.id)
    validPayload = sourceDocument([PRESET_STDIO])
    let merged = await market.catalog({ refresh: true })
    expect(merged.catalog.presets.filter((preset) => preset.sourceId === 'team')).toHaveLength(2)
    clock += 2000
    merged = await market.catalog({ refresh: true })
    expect(merged.catalog.presets.filter((preset) => preset.sourceId === 'team')).toHaveLength(1)
    expect(merged.sources.find((item) => item.id === 'team')?.entryCount).toBe(1)
  })

  it('keeps the previous cache when a refresh fails', async () => {
    const market = newMarket()
    const source = await market.saveSource({ name: 'Team', url: base + '/valid.json' })
    await market.refreshSources(source.id)
    await market.saveSource({ id: source.id, url: base + '/broken.json' })
    const refreshed = await market.refreshSources(source.id)
    const team = refreshed.find((item) => item.id === 'team')!
    expect(team.status).toBe('error')
    expect(team.error).toContain('JSON')
    expect(team.entryCount).toBe(0)
    // URL change clears the cache, so the broken refresh starts empty.
    const merged = await market.catalog({ refresh: false })
    expect(merged.catalog.presets.filter((preset) => preset.sourceId === 'team')).toHaveLength(0)
  })

  it('keeps the old cache when the same URL fails later', async () => {
    const market = newMarket({ requestTimeoutMs: 300 })
    const source = await market.saveSource({ name: 'Team', url: base + '/valid.json' })
    await market.refreshSources(source.id)
    const file = await readFile(market.sourcesPath, 'utf8')
    const parsed = JSON.parse(file) as { sources: { id: string; url: string }[] }
    parsed.sources[0]!.url = base + '/slow.json'
    await writeFile(market.sourcesPath, JSON.stringify(parsed), 'utf8')
    const refreshed = await market.refreshSources(source.id)
    const team = refreshed.find((item) => item.id === 'team')!
    expect(team.status).toBe('error')
    expect(team.error).toContain('超时')
    expect(team.entryCount).toBe(2)
    const merged = await market.catalog({ refresh: false })
    expect(merged.catalog.presets.filter((preset) => preset.sourceId === 'team')).toHaveLength(2)
  })

  it('reports oversized bodies and bad HTTP responses', async () => {
    const market = newMarket({ maxBytes: 1024 })
    const big = await market.saveSource({ name: 'Big', url: base + '/big.json' })
    const refreshed = await market.refreshSources(big.id)
    const bigSource = refreshed.find((item) => item.id === 'big')!
    expect(bigSource.status).toBe('error')
    expect(bigSource.error).toContain('超过')
    const missing = await market.saveSource({ name: 'Missing', url: base + '/missing.json' })
    const afterMissing = await market.refreshSources(missing.id)
    const missingSource = afterMissing.find((item) => item.id === 'missing')!
    expect(missingSource.status).toBe('error')
    expect(missingSource.error).toContain('HTTP 404')
  })

  it('finds presets by source and reports ambiguity across sources', async () => {
    const market = newMarket()
    const team = await market.saveSource({ name: 'Team', url: base + '/valid.json' })
    await market.refreshSources(team.id)
    const preset = await market.findPreset('remote-echo', 'team')
    expect(preset.serverName).toBe('remote-echo')
    expect(await market.findPreset('remote-echo')).toMatchObject({ sourceId: 'team' })
    await expect(market.findPreset('remote-echo', 'nope')).rejects.toMatchObject({ status: 404 })
    const second = await market.saveSource({ name: 'Second', url: base + '/valid.json' })
    await market.refreshSources(second.id)
    await expect(market.findPreset('remote-echo')).rejects.toMatchObject({ status: 400, code: 'ambiguous-preset' })
    await expect(market.findPreset('remote-echo', team.id)).resolves.toBeDefined()
  })

  it('rejects a corrupt sources.json', async () => {
    const market = newMarket()
    await mkdir(join(root, 'home', 'mcp-station'), { recursive: true })
    await writeFile(market.sourcesPath, '{bad json', 'utf8')
    await expect(market.listSources()).rejects.toMatchObject({ status: 500, code: 'market-invalid' })
  })
})

describe('Settings', () => {
  it('defaults to auto, persists zh and rejects invalid values', async () => {
    const market = newMarket()
    expect(await market.getSettings()).toEqual({ displayLanguage: 'auto' })
    expect(await market.saveSettings({ displayLanguage: 'zh' })).toEqual({ displayLanguage: 'zh' })
    const reloaded = newMarket()
    expect(await reloaded.getSettings()).toEqual({ displayLanguage: 'zh' })
    const persisted = JSON.parse(await readFile(market.settingsPath, 'utf8')) as { displayLanguage: string }
    expect(persisted.displayLanguage).toBe('zh')
    await expect(market.saveSettings({ displayLanguage: 'fr' })).rejects.toMatchObject({ status: 400 })
  })
})
