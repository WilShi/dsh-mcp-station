/**
 * MCP official Registry source (https://registry.modelcontextprotocol.io).
 *
 * The registry is paged and searchable, so it is not merged into
 * data/catalog.json: the market browse API queries it on demand. Only servers
 * we can install are mapped: npm packages with a stdio transport, or
 * streamable-http remotes. Everything else is skipped.
 *
 * Responses are cached for five minutes per query (search + limit + cursor).
 */

import type { CatalogPreset, LocalizedText, PresetInput } from './shared/types.ts'

/** Stable source id of the official MCP Registry. */
export const REGISTRY_SOURCE_ID = 'mcp-registry'
/** Display name of the official MCP Registry source. */
export const REGISTRY_SOURCE_NAME = 'MCP 官方注册表'
/** Default registry endpoint (the version is added as a query parameter). */
export const DEFAULT_REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io/v0/servers'
/** Registry response cache lifetime: five minutes. */
export const DEFAULT_REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000
/** The registry accepts at most 100 servers per page. */
export const REGISTRY_PAGE_LIMIT_MAX = 100
const DEFAULT_TIMEOUT_MS = 15 * 1000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/
const PRESET_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/

/** Options for the registry client (tests inject the fake server and clock). */
export interface RegistryClientOptions {
  fetchImpl?: typeof fetch
  now?: () => number
  baseUrl?: string
  timeoutMs?: number
  maxBytes?: number
  cacheTtlMs?: number
}

/** One mapped registry page. */
export interface RegistryPage {
  items: CatalogPreset[]
  nextCursor?: string
  totalCount?: number
}

interface CachedPage {
  at: number
  page: RegistryPage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function localized(value: string): LocalizedText {
  return { zh: value, en: value }
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit - 1) + '...' : value
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  const body = response.body
  if (body === null) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) throw new Error('registry 响应超过 ' + String(maxBytes) + ' 字节')
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
        throw new Error('registry 响应超过 ' + String(maxBytes) + ' 字节')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (isRecord(value)) {
    const out: Record<string, string> = {}
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') out[key] = item
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  return undefined
}

function argumentValues(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const values: string[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    if (item.type !== undefined && item.type !== 'positional') continue
    if (typeof item.value === 'string') values.push(item.value)
  }
  return values
}

interface NamedArguments {
  args: string[]
  inputs: PresetInput[]
}

function namedArguments(value: unknown): NamedArguments {
  const args: string[] = []
  const inputs: PresetInput[] = []
  if (!Array.isArray(value)) return { args, inputs }
  for (const item of value) {
    if (!isRecord(item) || item.type !== 'named') continue
    if (typeof item.name === 'string' && item.name !== '') args.push(item.name)
    if (typeof item.value !== 'string' || item.value === '') continue
    let rendered = item.value
    if (isRecord(item.variables)) {
      for (const [variableName, variableSpec] of Object.entries(item.variables)) {
        const key = variableName.replace(/[^A-Za-z0-9_]/g, '_')
        if (key === '') continue
        const spec = isRecord(variableSpec) ? variableSpec : {}
        rendered = rendered.split('{' + variableName + '}').join('{{' + key + '}}')
        const input: PresetInput = {
          key,
          label: localized(key),
          description: localized(key),
          kind: spec.isSecret === true ? 'secret' : 'text',
        }
        if (spec.isRequired === true) input.required = true
        inputs.push(input)
      }
    }
    args.push(rendered)
  }
  return { args, inputs }
}

function headerInputKey(name: string): string {
  const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return key === '' ? 'HEADER' : key
}

interface EnvironmentVariable {
  name: string
  description?: string
  isSecret: boolean
  isRequired: boolean
  defaultValue?: string
}

function environmentVariables(value: unknown): EnvironmentVariable[] {
  if (!Array.isArray(value)) return []
  const variables: EnvironmentVariable[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (name === '') continue
    const variable: EnvironmentVariable = {
      name,
      isSecret: item.isSecret === true,
      isRequired: item.isRequired === true,
    }
    if (typeof item.description === 'string' && item.description.trim() !== '') {
      variable.description = item.description.trim()
    }
    if (typeof item.default === 'string') variable.defaultValue = item.default
    else if (typeof item.value === 'string') variable.defaultValue = item.value
    variables.push(variable)
  }
  return variables
}

function allocateName(baseValue: string, used: Set<string>, maxLength: number, fallback: string): string {
  let base = baseValue
  if (base === '') base = fallback
  base = base.slice(0, maxLength)
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  for (let index = 2; index < 100; index += 1) {
    const suffix = '-' + String(index)
    const candidate = base.slice(0, Math.max(1, maxLength - suffix.length)) + suffix
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  throw new Error('registry: 无法生成唯一名称')
}

function serverNameFromName(value: string): string {
  const tail = value.split('/').pop() ?? value
  const cleaned = tail
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return cleaned === '' ? 'mcp-server' : cleaned
}

function presetIdFromName(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return cleaned === '' ? 'mcp-server' : cleaned
}

const registryNameByPresetId = new Map<string, string>()

function riskForRegistry(): CatalogPreset['risk'] {
  return {
    level: 'medium',
    reasons: [
      {
        zh: '来自 MCP 官方注册表，未经 MCP Station 审核',
        en: 'From the official MCP Registry; not reviewed by MCP Station',
      },
    ],
  }
}

function remoteHeaders(value: unknown): { headers?: Record<string, string>; inputs: PresetInput[] } {
  const headers: Record<string, string> = {}
  const inputs: PresetInput[] = []
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') headers[key] = item
    }
    return Object.keys(headers).length > 0 ? { headers, inputs } : { inputs }
  }
  if (!Array.isArray(value)) return { inputs }
  for (const item of value) {
    if (!isRecord(item)) continue
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (name === '') continue
    if (typeof item.value === 'string') {
      headers[name] = item.value
      continue
    }
    if (item.isRequired === true || item.isSecret === true) {
      const key = headerInputKey(name)
      headers[name] = '{{' + key + '}}'
      const input: PresetInput = {
        key,
        label: localized(name),
        description: localized(name),
        kind: item.isSecret === true ? 'secret' : 'text',
        required: item.isRequired === true,
      }
      inputs.push(input)
    }
  }
  return Object.keys(headers).length > 0 ? { headers, inputs } : { inputs }
}

interface MappedNames {
  serverNames: Set<string>
  presetIds: Set<string>
}

function mapServer(server: Record<string, unknown>, names: MappedNames): CatalogPreset | undefined {
  const registryName = typeof server.name === 'string' ? server.name.trim() : ''
  if (registryName === '') return undefined
  const title = typeof server.title === 'string' && server.title.trim() !== '' ? server.title.trim() : registryName
  const description = typeof server.description === 'string' ? server.description.trim() : ''
  const repository = isRecord(server.repository) && typeof server.repository.url === 'string'
    ? server.repository.url
    : undefined
  const serverName = allocateName(serverNameFromName(registryName), names.serverNames, 32, 'mcp-server')
  const presetId = allocateName(presetIdFromName(registryName), names.presetIds, 64, 'mcp-server')
  if (!SERVER_NAME_RE.test(serverName) || !PRESET_ID_RE.test(presetId)) return undefined

  const packages = Array.isArray(server.packages) ? server.packages : []
  for (const item of packages) {
    if (!isRecord(item)) continue
    if (item.registryType !== 'npm') continue
    const transport = isRecord(item.transport) ? item.transport : undefined
    if (transport === undefined || transport.type !== 'stdio') continue
    const identifier = typeof item.identifier === 'string' ? item.identifier.trim() : ''
    if (identifier === '') continue
    const runtimeHint = typeof item.runtimeHint === 'string' && item.runtimeHint.trim() !== '' ? item.runtimeHint.trim() : 'npx'
    const named = namedArguments(item.runtimeArguments)
    const args = [...argumentValues(item.runtimeArguments), ...named.args, identifier]
    const variables = environmentVariables(item.environmentVariables)
    const env: Record<string, string> = {}
    const inputs: PresetInput[] = []
    for (const variable of variables) {
      env[variable.name] = '{{' + variable.name + '}}'
      const label = localized(variable.name)
      const descriptionText = variable.description ?? variable.name
      const input: PresetInput = {
        key: variable.name,
        label,
        description: localized(descriptionText),
        kind: variable.isSecret ? 'secret' : 'text',
      }
      if (variable.isRequired) input.required = true
      if (variable.defaultValue !== undefined) input.default = variable.defaultValue
      inputs.push(input)
    }
    for (const input of named.inputs) {
      if (!inputs.some((existing) => existing.key === input.key)) inputs.push(input)
    }
    const preset: CatalogPreset = {
      id: presetId,
      serverName,
      displayName: localized(title),
      tagline: localized(truncate(description, 140)),
      description: localized(description),
      category: 'dev',
      transport: 'stdio',
      command: runtimeHint,
      args,
      risk: riskForRegistry(),
    }
    if (inputs.length > 0) {
      preset.inputs = inputs
      preset.env = env
    }
    if (repository !== undefined) preset.docs = repository
    preset.tags = ['mcp-registry']
    registryNameByPresetId.set(preset.id, registryName)
    return preset
  }

  const remotes = Array.isArray(server.remotes) ? server.remotes : []
  for (const item of remotes) {
    if (!isRecord(item)) continue
    if (item.type !== 'streamable-http') continue
    const url = typeof item.url === 'string' ? item.url.trim() : ''
    if (url === '') continue
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    const remote = remoteHeaders(item.headers)
    const preset: CatalogPreset = {
      id: presetId,
      serverName,
      displayName: localized(title),
      tagline: localized(truncate(description, 140)),
      description: localized(description),
      category: 'dev',
      transport: 'streamable-http',
      url,
      risk: riskForRegistry(),
    }
    if (remote.headers !== undefined) preset.headers = remote.headers
    if (remote.inputs.length > 0) preset.inputs = remote.inputs
    if (repository !== undefined) preset.docs = repository
    preset.tags = ['mcp-registry']
    registryNameByPresetId.set(preset.id, registryName)
    return preset
  }
  return undefined
}

/** Paged client for the official MCP Registry with a five minute cache. */
export class RegistryClient {
  readonly baseUrl: string
  readonly cacheTtlMs: number
  readonly timeoutMs: number
  readonly maxBytes: number
  lastFetchedAt: number | undefined
  lastError: string | undefined
  lastCount: number | undefined
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly cache = new Map<string, CachedPage>()

  constructor(options: RegistryClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.baseUrl = options.baseUrl ?? DEFAULT_REGISTRY_BASE_URL
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_REGISTRY_CACHE_TTL_MS
  }

  /** Fetch one page (cached for five minutes); search/cursor are passed through. */
  async fetchPage(params: { search?: string; cursor?: string; limit?: number } = {}): Promise<RegistryPage> {
    const limit = Math.max(1, Math.min(REGISTRY_PAGE_LIMIT_MAX, Math.floor(params.limit ?? 20)))
    const url = new URL(this.baseUrl)
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('version', 'latest')
    if (params.search !== undefined && params.search !== '') url.searchParams.set('search', params.search)
    if (params.cursor !== undefined && params.cursor !== '') url.searchParams.set('cursor', params.cursor)
    const key = url.toString()
    const cached = this.cache.get(key)
    if (cached !== undefined && this.now() - cached.at < this.cacheTtlMs) {
      this.lastCount = cached.page.totalCount ?? cached.page.items.length
      return cached.page
    }
    const page = await this.fetchPageFromNetwork(url)
    this.cache.set(key, { at: this.now(), page })
    this.lastFetchedAt = this.now()
    this.lastCount = page.totalCount ?? page.items.length
    delete this.lastError
    return page
  }

  /** Find one mapped preset by preset id (cache first, then a registry search). */
  async findPreset(presetId: string): Promise<CatalogPreset | undefined> {
    for (const cached of this.cache.values()) {
      const found = cached.page.items.find((item) => item.id === presetId)
      if (found !== undefined) return found
    }
    const knownName = registryNameByPresetId.get(presetId)
    const queries = knownName === undefined ? [presetId.replace(/[-_.]+/g, ' '), presetId] : [knownName, presetId.replace(/[-_.]+/g, ' '), presetId]
    for (const search of queries) {
      if (search.trim() === '') continue
      const page = await this.fetchPage({ search, limit: REGISTRY_PAGE_LIMIT_MAX })
      const found = page.items.find((item) => item.id === presetId)
      if (found !== undefined) return found
    }
    return undefined
  }

  private async fetchPageFromNetwork(url: URL): Promise<RegistryPage> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    timer.unref?.()
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
        redirect: 'follow',
      })
      if (!response.ok) throw new Error('registry HTTP ' + String(response.status) + ' ' + response.statusText)
      const text = await readLimitedBody(response, this.maxBytes)
      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        throw new Error('registry 返回内容不是合法 JSON')
      }
      return mapRegistryResponse(parsed)
    } catch (error) {
      if (controller.signal.aborted) {
        this.lastError = 'registry 请求超时（' + String(this.timeoutMs) + 'ms）'
        throw new Error(this.lastError)
      }
      const message = errorMessage(error)
      this.lastError = message
      throw new Error(message)
    } finally {
      clearTimeout(timer)
    }
  }
}

interface RegistryMetaInfo {
  status?: string
  isLatest?: boolean
}

function metaInfo(record: Record<string, unknown>): RegistryMetaInfo {
  const meta = isRecord(record._meta) ? record._meta : undefined
  if (meta === undefined) return {}
  const official = isRecord(meta['io.modelcontextprotocol.registry/official'])
    ? meta['io.modelcontextprotocol.registry/official']
    : meta
  if (!isRecord(official)) return {}
  const info: RegistryMetaInfo = {}
  if (typeof official.status === 'string') info.status = official.status
  if (official.isLatest === true) info.isLatest = true
  return info
}

/** Map one registry response body into installable presets. */
export function mapRegistryResponse(value: unknown): RegistryPage {
  if (!isRecord(value)) throw new Error('registry 响应必须是对象')
  const servers = Array.isArray(value.servers) ? value.servers : []
  const metadata = isRecord(value.metadata) ? value.metadata : undefined
  const names: MappedNames = { serverNames: new Set(), presetIds: new Set() }
  const chosen = new Map<string, { server: Record<string, unknown>; isLatest: boolean }>()
  for (const entry of servers) {
    const record = isRecord(entry) ? entry : undefined
    if (record === undefined) continue
    const server = isRecord(record.server) ? record.server : record
    const name = typeof server.name === 'string' ? server.name.trim() : ''
    if (name === '') continue
    const meta = metaInfo(record)
    if (meta.status !== undefined && meta.status !== 'active') continue
    const isLatest = meta.isLatest === true
    const existing = chosen.get(name)
    if (existing === undefined) {
      chosen.set(name, { server, isLatest })
    } else if (isLatest && !existing.isLatest) {
      chosen.set(name, { server, isLatest })
    }
  }
  const items: CatalogPreset[] = []
  for (const entry of chosen.values()) {
    const preset = mapServer(entry.server, names)
    if (preset !== undefined) items.push(preset)
  }
  const page: RegistryPage = { items }
  const nextCursor = metadata !== undefined && typeof metadata.nextCursor === 'string' && metadata.nextCursor !== ''
    ? metadata.nextCursor
    : isRecord(value) && typeof value.nextCursor === 'string' && value.nextCursor !== ''
      ? value.nextCursor
      : undefined
  if (nextCursor !== undefined) page.nextCursor = nextCursor
  if (metadata !== undefined && typeof metadata.count === 'number' && Number.isFinite(metadata.count)) {
    page.totalCount = metadata.count
  }
  return page
}
