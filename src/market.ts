/**
 * Market sources: the bundled catalog plus persisted custom / remote sources.
 *
 * Builtin source reads data/catalog.json. Custom sources live in
 * $DSH_HOME/mcp-station/sources.json together with their last fetched preset
 * cache, so a failed refresh can always fall back to the previous data.
 * Remote sources are plain JSON documents: { version: 1, name?, presets }.
 * Fetches use GET, a 15 s timeout, a 5 MB body cap and a 10 minute cache.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { loadCatalog } from './catalog.ts'
import {
  DEFAULT_REGISTRY_BASE_URL,
  DEFAULT_REGISTRY_CACHE_TTL_MS,
  REGISTRY_PAGE_LIMIT_MAX,
  REGISTRY_SOURCE_ID,
  REGISTRY_SOURCE_NAME,
  RegistryClient,
} from './market-registry.ts'
import type { RegistryPage } from './market-registry.ts'
import type {
  CatalogFile,
  CatalogPreset,
  DisplayLanguage,
  LocalizedText,
  MarketBrowsePayload,
  MarketItem,
  MarketSource,
  MarketSourceInput,
  PresetCategory,
  PresetInput,
  PresetRisk,
  PresetSmoke,
  RiskLevel,
  StationSettings,
} from './shared/types.ts'

/** Stable id of the bundled source. */
export const BUILTIN_SOURCE_ID = 'builtin'
/** Display name of the bundled source. */
export const BUILTIN_SOURCE_NAME = 'MCP Station 精选'
/** Directory under DSH Home that keeps market state. */
export const MARKET_DIR_NAME = 'mcp-station'
/** File name of the persisted custom source list. */
export const SOURCES_FILENAME = 'sources.json'
/** File name of the persisted host settings. */
export const SETTINGS_FILENAME = 'settings.json'
/** Remote source cache lifetime: 10 minutes. */
export const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000
/** One remote fetch may take at most 15 seconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 1000
/** One remote source body may be at most 5 MB. */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
/** Settings default. */
export const DEFAULT_DISPLAY_LANGUAGE: DisplayLanguage = 'auto'

const SOURCE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/
const PRESET_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/
const CATEGORIES: readonly PresetCategory[] = ['browser', 'search', 'dev', 'data', 'memory', 'productivity']
const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high']
const INPUT_KINDS: readonly PresetInput['kind'][] = ['text', 'secret', 'path', 'url']
const DISPLAY_LANGUAGES: readonly DisplayLanguage[] = ['auto', 'zh', 'en']

/** Market-layer failure carrying the HTTP status and stable code we expose. */
export class MarketError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'MarketError'
    this.status = status
    this.code = code
  }
}

/** Collaborators and limits of a Market instance. */
export interface MarketOptions {
  /** DSH Home directory that owns mcp-station/sources.json and settings.json. */
  dshHome: string
  /** Fetch implementation; defaults to the global fetch (tests inject one). */
  fetchImpl?: typeof fetch
  /** Clock used for cache TTL, defaults to Date.now (tests inject one). */
  now?: () => number
  cacheTtlMs?: number
  requestTimeoutMs?: number
  maxBytes?: number
  /** Official MCP Registry endpoint (tests point it at a fake server). */
  registryBaseUrl?: string
  /** Registry response cache lifetime, defaults to five minutes. */
  registryCacheTtlMs?: number
}

interface StoredPresetCache {
  presets: CatalogPreset[]
  fetchedAt: number
  entryCount: number
  catalogName?: string
  catalogUpdated?: string
}

interface StoredSource {
  id: string
  name: string
  url: string
  enabled: boolean
  language?: DisplayLanguage
  headers?: Record<string, string>
  lastFetchedAt?: number
  status?: 'ok' | 'error'
  error?: string
  entryCount?: number
  cache?: StoredPresetCache
}

interface SourcesFile {
  version: number
  sources: StoredSource[]
}

interface SettingsFile extends StationSettings {
  version: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asStringMap(value: unknown): Record<string, string> | undefined | 'invalid' {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) return 'invalid'
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') return 'invalid'
    out[key] = item
  }
  return out
}

function isDisplayLanguage(value: unknown): value is DisplayLanguage {
  return value === 'auto' || value === 'zh' || value === 'en'
}

function localized(value: unknown, fallback: string): LocalizedText {
  if (isRecord(value)) {
    const zh = typeof value.zh === 'string' ? value.zh : undefined
    const en = typeof value.en === 'string' ? value.en : undefined
    if (zh !== undefined || en !== undefined) return { zh: zh ?? en ?? fallback, en: en ?? zh ?? fallback }
  }
  return { zh: fallback, en: fallback }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function annotatePreset(preset: CatalogPreset, sourceId: string, sourceName: string): MarketItem {
  return { ...preset, sourceId, sourceName, uid: sourceId + ':' + preset.id }
}

function matchesSearch(preset: CatalogPreset, search: string): boolean {
  if (search === '') return true
  const needle = search.toLowerCase()
  return [
    preset.id,
    preset.serverName,
    preset.displayName.zh,
    preset.displayName.en,
    preset.tagline.zh,
    preset.tagline.en,
    preset.description.zh,
    preset.description.en,
    preset.docs ?? '',
    ...(preset.tags ?? []),
  ]
    .join('\n')
    .toLowerCase()
    .includes(needle)
}

function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (cursor === undefined || cursor === '') return undefined
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function sanitizeInputs(value: unknown): PresetInput[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return undefined
  const inputs: PresetInput[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    if (key === '') continue
    const kind = typeof item.kind === 'string' && INPUT_KINDS.includes(item.kind as PresetInput['kind'])
      ? (item.kind as PresetInput['kind'])
      : 'text'
    const input: PresetInput = {
      key,
      label: localized(item.label, key),
      description: localized(item.description, ''),
      kind,
    }
    if (item.required === true) input.required = true
    if (typeof item.placeholder === 'string') input.placeholder = item.placeholder
    if (typeof item.default === 'string') input.default = item.default
    inputs.push(input)
  }
  return inputs
}

function sanitizeRisk(value: unknown): PresetRisk {
  if (!isRecord(value)) return { level: 'medium', reasons: [] }
  const level = typeof value.level === 'string' && RISK_LEVELS.includes(value.level as RiskLevel)
    ? (value.level as RiskLevel)
    : 'medium'
  const reasons: LocalizedText[] = []
  if (Array.isArray(value.reasons)) {
    for (const reason of value.reasons) {
      if (isRecord(reason) && (typeof reason.zh === 'string' || typeof reason.en === 'string')) {
        reasons.push(localized(reason, ''))
      }
    }
  }
  return { level, reasons }
}

function sanitizeSmoke(value: unknown): PresetSmoke | undefined {
  if (!isRecord(value)) return undefined
  const tool = typeof value.tool === 'string' ? value.tool.trim() : ''
  if (tool === '') return undefined
  const smoke: PresetSmoke = { tool }
  if (isRecord(value.args)) smoke.args = value.args
  if (typeof value.expectContains === 'string') smoke.expectContains = value.expectContains
  return smoke
}

/** Validate and normalize one preset from a remote source; undefined means invalid. */
function sanitizeRemotePreset(value: unknown): CatalogPreset | undefined {
  if (!isRecord(value)) return undefined
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!PRESET_ID_RE.test(id)) return undefined
  const serverName = typeof value.serverName === 'string' ? value.serverName.trim() : ''
  if (!SERVER_NAME_RE.test(serverName)) return undefined
  const transport = value.transport === 'streamable-http' ? 'streamable-http' : value.transport === 'stdio' ? 'stdio' : undefined
  if (transport === undefined) return undefined
  let command: string | undefined
  let url: string | undefined
  if (transport === 'stdio') {
    command = typeof value.command === 'string' ? value.command.trim() : undefined
    if (command === undefined || command === '') return undefined
  } else {
    url = typeof value.url === 'string' ? value.url.trim() : undefined
    if (url === undefined || !isHttpUrl(url)) return undefined
  }
  let args: string[] | undefined
  if (value.args !== undefined) {
    if (!Array.isArray(value.args) || value.args.some((item) => typeof item !== 'string')) return undefined
    args = value.args as string[]
  }
  const env = asStringMap(value.env)
  if (env === 'invalid') return undefined
  const headers = asStringMap(value.headers)
  if (headers === 'invalid') return undefined
  const category = typeof value.category === 'string' && CATEGORIES.includes(value.category as PresetCategory)
    ? (value.category as PresetCategory)
    : 'dev'
  const preset: CatalogPreset = {
    id,
    serverName,
    displayName: localized(value.displayName, id),
    tagline: localized(value.tagline, ''),
    description: localized(value.description, ''),
    category,
    transport,
    risk: sanitizeRisk(value.risk),
  }
  if (command !== undefined) preset.command = command
  if (args !== undefined) preset.args = args
  if (url !== undefined) preset.url = url
  if (env !== undefined) preset.env = env
  if (headers !== undefined) preset.headers = headers
  const inputs = sanitizeInputs(value.inputs)
  if (inputs !== undefined) preset.inputs = inputs
  if (isRecord(value.requires)) {
    const requires: NonNullable<CatalogPreset['requires']> = {}
    if (value.requires.chrome === true) requires.chrome = true
    if (value.requires.node === true) requires.node = true
    if (value.requires.apiKey === true) requires.apiKey = true
    preset.requires = requires
  }
  if (typeof value.docs === 'string') preset.docs = value.docs
  if (Array.isArray(value.tags)) preset.tags = value.tags.filter((item): item is string => typeof item === 'string')
  const smoke = sanitizeSmoke(value.smoke)
  if (smoke !== undefined) preset.smoke = smoke
  if (isRecord(value.note)) preset.note = localized(value.note, '')
  return preset
}

/** Parse one remote source document into a cache; throws on invalid documents. */
function sanitizeRemoteCatalog(value: unknown, now: number): StoredPresetCache {
  if (!isRecord(value)) throw new Error('远程源 JSON 必须是对象')
  if (value.version !== 1) throw new Error('远程源 version 必须为 1')
  if (!Array.isArray(value.presets)) throw new Error('远程源缺少 presets 数组')
  const presets: CatalogPreset[] = []
  const seen = new Set<string>()
  for (const item of value.presets) {
    const preset = sanitizeRemotePreset(item)
    if (preset === undefined || seen.has(preset.id)) continue
    seen.add(preset.id)
    presets.push(preset)
  }
  if (value.presets.length > 0 && presets.length === 0) throw new Error('远程源没有有效的 preset')
  const cache: StoredPresetCache = { presets, fetchedAt: now, entryCount: presets.length }
  if (typeof value.name === 'string' && value.name.trim() !== '') cache.catalogName = value.name.trim()
  if (typeof value.updated === 'string' && value.updated.trim() !== '') cache.catalogUpdated = value.updated.trim()
  return cache
}

function sanitizeStoredCache(value: unknown): StoredPresetCache | undefined {
  if (!isRecord(value) || !Array.isArray(value.presets)) return undefined
  const presets: CatalogPreset[] = []
  const seen = new Set<string>()
  for (const item of value.presets) {
    const preset = sanitizeRemotePreset(item)
    if (preset === undefined || seen.has(preset.id)) continue
    seen.add(preset.id)
    presets.push(preset)
  }
  const fetchedAt = typeof value.fetchedAt === 'number' && Number.isFinite(value.fetchedAt) ? value.fetchedAt : 0
  const cache: StoredPresetCache = {
    presets,
    fetchedAt,
    entryCount: typeof value.entryCount === 'number' && value.entryCount >= 0 ? value.entryCount : presets.length,
  }
  if (typeof value.catalogName === 'string') cache.catalogName = value.catalogName
  if (typeof value.catalogUpdated === 'string') cache.catalogUpdated = value.catalogUpdated
  return cache
}

function sanitizeStoredSource(value: unknown): StoredSource | undefined {
  if (!isRecord(value)) return undefined
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!SOURCE_ID_RE.test(id) || isReservedSourceId(id)) return undefined
  const url = typeof value.url === 'string' ? value.url.trim() : ''
  if (!isHttpUrl(url)) return undefined
  const source: StoredSource = {
    id,
    name: typeof value.name === 'string' && value.name.trim() !== '' ? value.name.trim() : id,
    url,
    enabled: value.enabled !== false,
  }
  if (isDisplayLanguage(value.language)) source.language = value.language
  const headers = asStringMap(value.headers)
  if (headers !== undefined && headers !== 'invalid') source.headers = headers
  if (typeof value.lastFetchedAt === 'number' && Number.isFinite(value.lastFetchedAt)) source.lastFetchedAt = value.lastFetchedAt
  if (value.status === 'ok' || value.status === 'error') source.status = value.status
  if (typeof value.error === 'string') source.error = value.error
  if (typeof value.entryCount === 'number' && value.entryCount >= 0) source.entryCount = value.entryCount
  const cache = sanitizeStoredCache(value.cache)
  if (cache !== undefined) source.cache = cache
  return source
}

async function readJsonFile(path: string, label: string): Promise<unknown | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new MarketError(500, 'market-io', '读取 ' + label + ' 失败: ' + errorMessage(error))
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new MarketError(500, 'market-invalid', label + ' 不是合法 JSON')
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const tempPath = join(dir, '.' + basename(path) + '.tmp-' + String(process.pid) + '-' + Math.random().toString(36).slice(2, 8))
  try {
    await writeFile(tempPath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    try {
      await rename(tempPath, path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw error
      await rm(path, { force: true })
      await rename(tempPath, path)
    }
  } finally {
    await rm(tempPath, { force: true }).catch(() => {})
  }
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  const body = response.body
  if (body === null) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) throw new Error('远程源响应超过 ' + String(maxBytes) + ' 字节')
    return buffer.toString('utf8')
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done === true) break
      const value = next.value
      if (value === undefined) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error('远程源响应超过 ' + String(maxBytes) + ' 字节')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

function isReservedSourceId(id: string): boolean {
  return id === BUILTIN_SOURCE_ID || id === REGISTRY_SOURCE_ID
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug === '' ? 'source' : slug
}

/**
 * Market facade. One instance is cheap: sources.json is re-read per call so
 * several processes (CLI and web host) stay consistent.
 */
export class Market {
  readonly dshHome: string
  readonly cacheTtlMs: number
  readonly requestTimeoutMs: number
  readonly maxBytes: number
  private readonly fetchImpl: typeof fetch
  private readonly nowFn: () => number
  private readonly registry: RegistryClient

  constructor(options: MarketOptions) {
    this.dshHome = options.dshHome
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.nowFn = options.now ?? Date.now
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.registry = new RegistryClient({
      fetchImpl: options.fetchImpl,
      now: options.now,
      baseUrl: options.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL,
      timeoutMs: this.requestTimeoutMs,
      maxBytes: this.maxBytes,
      cacheTtlMs: options.registryCacheTtlMs ?? DEFAULT_REGISTRY_CACHE_TTL_MS,
    })
  }

  get stateDir(): string {
    return join(this.dshHome, MARKET_DIR_NAME)
  }

  get sourcesPath(): string {
    return join(this.stateDir, SOURCES_FILENAME)
  }

  get settingsPath(): string {
    return join(this.stateDir, SETTINGS_FILENAME)
  }

  /** List the builtin source and every persisted custom source (no network). */
  async listSources(): Promise<MarketSource[]> {
    const builtin = await this.builtinCatalog()
    const stored = await this.readStoredSources()
    return [builtin.source, this.registrySourceView(), ...stored.map((source) => this.sourceView(source))]
  }

  /** Create or update one custom source. */
  async saveSource(input: MarketSourceInput): Promise<MarketSource> {
    const stored = await this.readStoredSources()
    const requestedId = typeof input.id === 'string' ? input.id.trim() : ''
    let existing: StoredSource | undefined
    let id: string
    if (requestedId !== '') {
      if (isReservedSourceId(requestedId)) throw new MarketError(400, 'invalid-source', '内置源不能修改')
      if (!SOURCE_ID_RE.test(requestedId)) {
        throw new MarketError(400, 'invalid-source', 'source id 必须是 1-32 位字母、数字、下划线或连字符')
      }
      id = requestedId
      existing = stored.find((source) => source.id === id)
    } else {
      let seed = 'source'
      if (typeof input.name === 'string' && input.name.trim() !== '') {
        seed = input.name.trim()
      } else if (typeof input.url === 'string' && input.url.trim() !== '') {
        try {
          seed = new URL(input.url).hostname
        } catch {
          throw new MarketError(400, 'invalid-source', 'url 必须是 http(s) 地址')
        }
      }
      id = this.uniqueSourceId(slugify(seed), stored)
    }
    const url = typeof input.url === 'string' && input.url.trim() !== ''
      ? input.url.trim()
      : existing?.url
    if (url === undefined) throw new MarketError(400, 'invalid-source', '创建市场源必须提供 url')
    if (!isHttpUrl(url)) throw new MarketError(400, 'invalid-source', 'url 必须是 http(s) 地址')
    let language: DisplayLanguage | undefined
    if (input.language !== undefined) {
      if (!isDisplayLanguage(input.language)) throw new MarketError(400, 'invalid-source', 'language 必须是 auto/zh/en')
      language = input.language
    } else {
      language = existing?.language
    }
    let headers: Record<string, string> | undefined
    if (input.headers !== undefined) {
      const parsed = asStringMap(input.headers)
      if (parsed === undefined || parsed === 'invalid') {
        throw new MarketError(400, 'invalid-source', 'headers 必须是字符串映射')
      }
      headers = parsed
    } else {
      headers = existing?.headers
    }
    const name = typeof input.name === 'string' && input.name.trim() !== ''
      ? input.name.trim()
      : existing?.name ?? id
    const enabled = input.enabled !== undefined ? input.enabled === true : existing?.enabled ?? true
    const next: StoredSource = {
      ...(existing ?? {}),
      id,
      name,
      url,
      enabled,
      ...(language === undefined ? {} : { language }),
      ...(headers === undefined ? {} : { headers }),
    }
    if (existing !== undefined && existing.url !== url) {
      delete next.cache
      delete next.status
      delete next.error
      delete next.entryCount
      delete next.lastFetchedAt
    }
    const created = existing === undefined
    if (created) stored.push(next)
    else stored[stored.findIndex((source) => source.id === id)] = next
    await this.writeStoredSources(stored)
    // A newly added (or re-pointed) source should be browsable immediately.
    const needsRefresh = enabled && (created || existing?.url !== url || existing?.cache === undefined)
    if (needsRefresh) {
      await this.refreshStoredSource(next)
      await this.writeStoredSources(stored)
    }
    return this.sourceView(next)
  }

  /** Delete one custom source. Builtin is read-only; unknown ids return false. */
  async deleteSource(id: string): Promise<boolean> {
    if (isReservedSourceId(id)) throw new MarketError(400, 'invalid-source', '内置源不能删除')
    const stored = await this.readStoredSources()
    const next = stored.filter((source) => source.id !== id)
    if (next.length === stored.length) return false
    await this.writeStoredSources(next)
    return true
  }

  /**
   * Refresh one source (by id) or every enabled source. Failures stay on the
   * source (status + error) and keep the previous cache.
   */
  async refreshSources(id?: string): Promise<MarketSource[]> {
    const requestedId = typeof id === 'string' ? id.trim() : ''
    if (requestedId === BUILTIN_SOURCE_ID) return this.listSources()
    const stored = await this.readStoredSources()
    let targets: StoredSource[]
    if (requestedId !== '') {
      const found = stored.find((source) => source.id === requestedId)
      if (found === undefined) throw new MarketError(404, 'source-not-found', '找不到市场源: ' + requestedId)
      targets = [found]
    } else {
      targets = stored.filter((source) => source.enabled)
    }
    let changed = false
    await Promise.all(
      targets.map(async (source) => {
        const refreshed = await this.refreshStoredSource(source)
        if (refreshed) changed = true
      }),
    )
    if (changed) await this.writeStoredSources(stored)
    return this.listSources()
  }

  /**
   * Build the merged catalog. refresh=true re-fetches sources whose cache is
   * older than the TTL; forceRefresh=true re-fetches every enabled source.
   */
  async catalog(options: { refresh?: boolean; forceRefresh?: boolean } = {}): Promise<{ catalog: CatalogFile; sources: MarketSource[] }> {
    const builtin = await this.builtinCatalog()
    const stored = await this.readStoredSources()
    let changed = false
    if (options.refresh === true || options.forceRefresh === true) {
      const targets = stored.filter((source) => source.enabled)
      await Promise.all(
        targets.map(async (source) => {
          const stale = options.forceRefresh === true || this.isStale(source)
          if (!stale) return
          const refreshed = await this.refreshStoredSource(source)
          if (refreshed) changed = true
        }),
      )
      if (changed) await this.writeStoredSources(stored)
    }
    const presets: CatalogPreset[] = [...builtin.presets]
    for (const source of stored) {
      if (!source.enabled || source.cache === undefined) continue
      for (const preset of source.cache.presets) presets.push(annotatePreset(preset, source.id, source.name))
    }
    return {
      catalog: { version: builtin.catalog.version, updated: builtin.catalog.updated, presets },
      sources: [builtin.source, this.registrySourceView(), ...stored.map((source) => this.sourceView(source))],
    }
  }

  /** Resolve one preset by id, optionally scoped to a market source. */
  async findPreset(presetId: string, sourceId?: string): Promise<CatalogPreset> {
    const requestedSource = typeof sourceId === 'string' ? sourceId.trim() : ''
    if (requestedSource === REGISTRY_SOURCE_ID) {
      const preset = await this.tryRegistryPreset(presetId)
      if (preset === undefined) {
        throw new MarketError(404, 'preset-not-found', '官方注册表中找不到预设: ' + presetId)
      }
      return preset
    }
    const merged = await this.catalog({ refresh: true })
    if (requestedSource !== '') {
      const source = merged.sources.find((item) => item.id === requestedSource)
      if (source === undefined) throw new MarketError(404, 'source-not-found', '找不到市场源: ' + requestedSource)
      if (!source.enabled) throw new MarketError(400, 'source-disabled', '市场源已停用: ' + requestedSource)
      const preset = merged.catalog.presets.find(
        (item) => item.sourceId === requestedSource && item.id === presetId,
      )
      if (preset === undefined) {
        throw new MarketError(404, 'preset-not-found', '市场源中找不到预设: ' + requestedSource + ':' + presetId)
      }
      return preset
    }
    const builtin = merged.catalog.presets.find(
      (item) => item.sourceId === BUILTIN_SOURCE_ID && item.id === presetId,
    )
    if (builtin !== undefined) return builtin
    const matches = merged.catalog.presets.filter((item) => item.id === presetId)
    if (matches.length > 1) {
      throw new MarketError(400, 'ambiguous-preset', '多个市场源包含预设 ' + presetId + '，请指定 sourceId')
    }
    if (matches.length === 1) return matches[0]!
    // Convenience fallback only: an unreachable registry must not turn an
    // unknown local preset into a 502. Registry installs normally send sourceId.
    const registryPreset = await this.tryRegistryPreset(presetId).catch(() => undefined)
    if (registryPreset !== undefined) return registryPreset
    throw new MarketError(404, 'preset-not-found', '找不到预设: ' + presetId)
  }

  /**
   * Browse the merged market: local JSON sources are filtered in memory and
   * the official registry is queried page by page. A missing source means all
   * sources (local matches first, then registry results).
   */
  async browse(params: { search?: string; source?: string; cursor?: string; limit?: number } = {}): Promise<MarketBrowsePayload> {
    const search = typeof params.search === 'string' ? params.search.trim() : ''
    const requestedSource = typeof params.source === 'string' ? params.source.trim() : ''
    const limit = Math.max(1, Math.min(REGISTRY_PAGE_LIMIT_MAX, Math.floor(params.limit ?? 20)))
    const warnings: string[] = []
    const sourcesBefore = await this.listSources()
    if (requestedSource !== '') {
      const source = sourcesBefore.find((item) => item.id === requestedSource)
      if (source === undefined) throw new MarketError(404, 'source-not-found', '找不到市场源: ' + requestedSource)
      if (!source.enabled) throw new MarketError(400, 'source-disabled', '市场源已停用: ' + requestedSource)
      if (source.id === REGISTRY_SOURCE_ID) {
        let page: RegistryPage
        try {
          page = await this.registry.fetchPage({ search: search === '' ? undefined : search, cursor: params.cursor, limit })
        } catch (error) {
          throw new MarketError(502, 'registry-upstream', '官方注册表暂时不可用: ' + errorMessage(error))
        }
        return {
          items: page.items.map((preset) => annotatePreset(preset, source.id, source.name)),
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          sources: await this.listSources(),
        }
      }
      const { catalog } = await this.catalog({ refresh: false })
      const matched = catalog.presets.filter((preset) => preset.sourceId === source.id && matchesSearch(preset, search))
      const decoded = decodeCursor(params.cursor)
      const offset = decoded !== undefined && typeof decoded.offset === 'number' && decoded.offset >= 0 ? decoded.offset : 0
      const items = matched.slice(offset, offset + limit).map((preset) => annotatePreset(preset, source.id, source.name))
      const nextOffset = offset + items.length
      const nextCursor = nextOffset < matched.length ? encodeCursor({ offset: nextOffset }) : undefined
      return {
        items,
        ...(nextCursor === undefined ? {} : { nextCursor }),
        sources: await this.listSources(),
      }
    }

    const { catalog } = await this.catalog({ refresh: false })
    const locals = catalog.presets.filter((preset) => matchesSearch(preset, search))
    const decoded = decodeCursor(params.cursor)
    const localOffset =
      decoded !== undefined && typeof decoded.localOffset === 'number' && decoded.localOffset >= 0
        ? decoded.localOffset
        : 0
    const registryCursor =
      decoded !== undefined && typeof decoded.registryCursor === 'string' && decoded.registryCursor !== ''
        ? decoded.registryCursor
        : undefined
    const items: MarketItem[] = []
    let offset = localOffset
    if (offset < locals.length) {
      const localPage = locals.slice(offset, offset + limit)
      items.push(...localPage.map((preset) => preset as MarketItem))
      offset += localPage.length
    }
    let nextCursor: string | undefined
    if (offset < locals.length) {
      nextCursor = encodeCursor({ localOffset: offset })
    } else {
      const remaining = limit - items.length
      const shouldFetchRegistry = remaining > 0 || params.cursor !== undefined
      if (shouldFetchRegistry) {
        let page: RegistryPage | undefined
        try {
          page = await this.registry.fetchPage({
            search: search === '' ? undefined : search,
            cursor: registryCursor,
            limit: remaining > 0 ? remaining : limit,
          })
        } catch (error) {
          warnings.push('官方注册表暂时不可用: ' + errorMessage(error))
        }
        if (page !== undefined) {
          items.push(...page.items.map((preset) => annotatePreset(preset, REGISTRY_SOURCE_ID, REGISTRY_SOURCE_NAME)))
          if (page.nextCursor !== undefined) {
            nextCursor = encodeCursor({ localOffset: locals.length, registryCursor: page.nextCursor })
          }
        }
      } else {
        nextCursor = encodeCursor({ localOffset: locals.length })
      }
    }
    return {
      items,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      sources: await this.listSources(),
      ...(warnings.length === 0 ? {} : { warnings }),
    }
  }

  private async tryRegistryPreset(presetId: string): Promise<CatalogPreset | undefined> {
    let preset: CatalogPreset | undefined
    try {
      preset = await this.registry.findPreset(presetId)
    } catch (error) {
      throw new MarketError(502, 'registry-upstream', '官方注册表暂时不可用: ' + errorMessage(error))
    }
    if (preset === undefined) return undefined
    return annotatePreset(preset, REGISTRY_SOURCE_ID, REGISTRY_SOURCE_NAME)
  }

  /** Read host settings; a missing or corrupt file falls back to defaults. */
  async getSettings(): Promise<StationSettings> {
    let raw: unknown
    try {
      raw = await readJsonFile(this.settingsPath, 'settings.json')
    } catch {
      return { displayLanguage: DEFAULT_DISPLAY_LANGUAGE }
    }
    if (!isRecord(raw) || !isDisplayLanguage(raw.displayLanguage)) {
      return { displayLanguage: DEFAULT_DISPLAY_LANGUAGE }
    }
    return { displayLanguage: raw.displayLanguage }
  }

  /** Persist host settings; only displayLanguage is currently supported. */
  async saveSettings(input: { displayLanguage?: unknown }): Promise<StationSettings> {
    if (!isDisplayLanguage(input.displayLanguage)) {
      throw new MarketError(400, 'invalid-settings', 'displayLanguage 必须是 auto/zh/en')
    }
    const file: SettingsFile = { version: 1, displayLanguage: input.displayLanguage }
    await writeJsonAtomic(this.settingsPath, file)
    return { displayLanguage: input.displayLanguage }
  }

  private uniqueSourceId(base: string, stored: readonly StoredSource[]): string {
    const taken = new Set(stored.map((source) => source.id))
    if (!isReservedSourceId(base) && !taken.has(base)) return base
    for (let index = 2; index < 100; index += 1) {
      const candidate = base.slice(0, 30) + '-' + String(index)
      if (!isReservedSourceId(candidate) && !taken.has(candidate)) return candidate
    }
    throw new MarketError(500, 'invalid-source', '无法生成唯一的 source id')
  }

  private isStale(source: StoredSource): boolean {
    return source.cache === undefined || this.nowFn() - source.cache.fetchedAt >= this.cacheTtlMs
  }

  private async builtinCatalog(): Promise<{ catalog: CatalogFile; presets: CatalogPreset[]; source: MarketSource }> {
    const catalog = await loadCatalog()
    return {
      catalog,
      presets: catalog.presets.map((preset) => annotatePreset(preset, BUILTIN_SOURCE_ID, BUILTIN_SOURCE_NAME)),
      source: {
        id: BUILTIN_SOURCE_ID,
        name: BUILTIN_SOURCE_NAME,
        builtin: true,
        enabled: true,
        status: 'ok',
        entryCount: catalog.presets.length,
      },
    }
  }

  private registrySourceView(): MarketSource {
    const status = this.registry.lastError !== undefined
      ? 'error'
      : this.registry.lastFetchedAt !== undefined
        ? 'ok'
        : 'unknown'
    const view: MarketSource = {
      id: REGISTRY_SOURCE_ID,
      name: REGISTRY_SOURCE_NAME,
      builtin: true,
      enabled: true,
      status,
      entryCount: this.registry.lastCount ?? 0,
    }
    if (this.registry.lastFetchedAt !== undefined) {
      view.lastFetchedAt = new Date(this.registry.lastFetchedAt).toISOString()
    }
    if (this.registry.lastError !== undefined) view.error = this.registry.lastError
    return view
  }

  private sourceView(source: StoredSource): MarketSource {
    const enabled = source.enabled !== false
    const status = enabled ? (source.status === 'error' ? 'error' : source.cache !== undefined ? 'ok' : 'unknown') : 'disabled'
    const view: MarketSource = {
      id: source.id,
      name: source.name,
      builtin: false,
      enabled,
      status,
      entryCount: source.entryCount ?? source.cache?.entryCount ?? source.cache?.presets.length ?? 0,
    }
    if (source.url !== '') view.url = source.url
    if (source.language !== undefined) view.language = source.language
    if (source.headers !== undefined) view.headers = source.headers
    if (source.lastFetchedAt !== undefined) view.lastFetchedAt = new Date(source.lastFetchedAt).toISOString()
    if (source.status === 'error' && typeof source.error === 'string' && source.error !== '') view.error = source.error
    return view
  }

  private async refreshStoredSource(source: StoredSource): Promise<boolean> {
    try {
      const cache = await this.fetchSource(source)
      source.cache = cache
      source.status = 'ok'
      delete source.error
      source.lastFetchedAt = this.nowFn()
      source.entryCount = cache.entryCount
      return true
    } catch (error) {
      source.status = 'error'
      source.error = errorMessage(error)
      return true
    }
  }

  private async fetchSource(source: StoredSource): Promise<StoredPresetCache> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    timer.unref?.()
    try {
      const headers: Record<string, string> = { accept: 'application/json', ...(source.headers ?? {}) }
      const response = await this.fetchImpl(source.url, {
        method: 'GET',
        headers,
        signal: controller.signal,
        redirect: 'follow',
      })
      if (!response.ok) throw new Error('HTTP ' + String(response.status) + ' ' + response.statusText)
      const text = await readLimitedBody(response, this.maxBytes)
      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        throw new Error('远程源返回内容不是合法 JSON')
      }
      return sanitizeRemoteCatalog(parsed, this.nowFn())
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('远程源请求超时（' + String(this.requestTimeoutMs) + 'ms）')
      }
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      clearTimeout(timer)
    }
  }

  private async readStoredSources(): Promise<StoredSource[]> {
    const raw = await readJsonFile(this.sourcesPath, 'sources.json')
    if (raw === undefined) return []
    if (!isRecord(raw) || !Array.isArray(raw.sources)) {
      throw new MarketError(500, 'market-invalid', 'sources.json 格式不正确')
    }
    const sources: StoredSource[] = []
    for (const item of raw.sources) {
      const source = sanitizeStoredSource(item)
      if (source !== undefined) sources.push(source)
    }
    return sources
  }

  private async writeStoredSources(sources: readonly StoredSource[]): Promise<void> {
    const file: SourcesFile = { version: 1, sources: [...sources] }
    await writeJsonAtomic(this.sourcesPath, file)
  }
}
