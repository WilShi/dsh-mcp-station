/**
 * Shared types between the MCP Station host plugin and its web client.
 *
 * The HTTP contract is documented in docs/API.md. Keep this file free of
 * Node-only imports: the browser bundle imports it for type checking.
 */

export interface LocalizedText {
  zh: string
  en: string
}

export type PresetCategory = 'browser' | 'search' | 'dev' | 'data' | 'memory' | 'productivity'
export type McpTransport = 'stdio' | 'streamable-http'
export type RiskLevel = 'low' | 'medium' | 'high'
export type ServerStatus = 'connected' | 'error' | 'unknown' | 'disabled'

export interface PresetInput {
  key: string
  label: LocalizedText
  description: LocalizedText
  kind: 'text' | 'secret' | 'path' | 'url'
  required?: boolean
  placeholder?: string
  /** Default value; supports the same templates as args/env. */
  default?: string
}

export interface PresetRisk {
  level: RiskLevel
  reasons: LocalizedText[]
}

export interface PresetSmoke {
  /** MCP tool name to call after install. */
  tool: string
  args?: Record<string, unknown>
  /** Text expected in the tool result (case-insensitive substring). */
  expectContains?: string
}

export interface CatalogPreset {
  id: string
  serverName: string
  displayName: LocalizedText
  tagline: LocalizedText
  description: LocalizedText
  category: PresetCategory
  transport: McpTransport
  /** stdio only. Supports {{input}} templates. */
  command?: string
  /** stdio only. Supports {{input}} and {{workspace}} templates. */
  args?: string[]
  /** streamable-http only. Supports {{input}} templates. */
  url?: string
  /**
   * Extra environment for stdio servers. Values support:
   * - `{{inputKey}}` — supplied value;
   * - `env:NAME` — written as `!!js process.env.NAME` (no secret on disk);
   * - anything else — literal string.
   */
  env?: Record<string, string>
  /** Extra HTTP headers for streamable-http servers; values support `env:NAME`. */
  headers?: Record<string, string>
  inputs?: PresetInput[]
  requires?: {
    /** Needs a Chrome/Chromium-family browser on this machine. */
    chrome?: boolean
    /** Needs Node.js at runtime (npx-based presets). */
    node?: boolean
    /** Needs an API key or other secret. */
    apiKey?: boolean
  }
  risk: PresetRisk
  docs?: string
  tags?: string[]
  smoke?: PresetSmoke
  /** Short note shown in the install dialog (localized). */
  note?: LocalizedText
  /** Merged catalog only: market source this preset came from. */
  sourceId?: string
  /** Merged catalog only: display name of the market source. */
  sourceName?: string
  /** Merged catalog only: stable identity `sourceId:preset.id`. */
  uid?: string
}

export interface CatalogFile {
  version: number
  updated: string
  presets: CatalogPreset[]
}

/** Language setting shared by the host and the web client. */
export type DisplayLanguage = 'auto' | 'zh' | 'en'

/** Fetch state of one market source. */
export type SourceStatus = 'ok' | 'unknown' | 'error' | 'disabled'

/** One market source: the builtin catalog or a persisted custom/remote source. */
export interface MarketSource {
  id: string
  name: string
  /** True for the bundled catalog; read-only. */
  builtin: boolean
  enabled: boolean
  url?: string
  language?: DisplayLanguage
  /** Extra headers sent when fetching a remote source. */
  headers?: Record<string, string>
  status: SourceStatus
  error?: string
  /** ISO time of the last successful fetch. */
  lastFetchedAt?: string
  /** Number of presets currently cached from this source. */
  entryCount: number
}

/** One installable catalog entry in the merged market view. */
export type MarketItem = CatalogPreset & {
  sourceId: string
  sourceName: string
  /** Stable identity: sourceId + ':' + preset.id. */
  uid: string
}

/** Data returned by GET /market. */
export interface MarketBrowsePayload {
  items: MarketItem[]
  /** Opaque cursor; pass back as-is to fetch the next page. */
  nextCursor?: string
  sources: MarketSource[]
  /** Non-fatal source errors that did not block the page. */
  warnings?: string[]
}

/** Body of POST /sources: add a source, or update one by id. */
export interface MarketSourceInput {
  /** Stable source id; omitted on create to generate one. */
  id?: string
  name?: string
  /** Required on create; omitted on update keeps the previous URL. */
  url?: string
  enabled?: boolean
  language?: DisplayLanguage
  headers?: Record<string, string>
}

/** Host settings persisted under DSH Home. */
export interface StationSettings {
  displayLanguage: DisplayLanguage
}

export interface ToolSummary {
  name: string
  description?: string
  inputSchema?: unknown
  /** Heuristic flags surfaced by the UI. */
  dangerous?: boolean
}

export interface InstalledServer {
  serverName: string
  presetId?: string
  /** Market source of the matched preset (merged catalog), when known. */
  sourceId?: string
  sourceName?: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  /** Local environment of the row; `env:NAME` means a process.env reference (never a secret on disk). */
  env?: Record<string, string>
  /** HTTP headers of the row; `env:NAME` means a process.env reference. */
  headers?: Record<string, string>
  enabled: boolean
  origin: 'station' | 'external'
  status: ServerStatus
  toolCount?: number
  tools?: ToolSummary[]
  error?: string
  latencyMs?: number
  lastCheckedAt?: string
  /** Localized display label when it comes from a known preset. */
  displayName?: LocalizedText
}

export interface StationStatus {
  pluginVersion: string
  dshVersion: string
  profile: string
  profileDir: string
  patchPath: string
  catalogVersion: number
  catalogUpdated: string
  presetCount: number
  installedCount: number
  chrome: {
    available: boolean
    path?: string
    version?: string
  }
  playwrightBrowsers: string[]
  warnings: string[]
}

export interface ProbeResult {
  ok: boolean
  tools: ToolSummary[]
  toolCount: number
  latencyMs: number
  serverInfo?: {
    name?: string
    version?: string
  }
  error?: string
}

export interface SmokeResult {
  ok: boolean
  tool: string
  latencyMs: number
  output?: string
  error?: string
}

export interface DoctorCheck {
  id: string
  label: LocalizedText
  ok: boolean
  detail?: string
  hint?: LocalizedText
}

export interface InstallRequest {
  presetId: string
  /** Market source id; omit to use the builtin catalog first. */
  sourceId?: string
  /** Override the preset serverName (must be unique). */
  serverName?: string
  values?: Record<string, string>
  /** Probe right after install and return the merged status/tools. */
  test?: boolean
}

/** Body of POST /servers/custom and POST /servers/custom/update. */
export interface CustomServerRequest {
  /** Primary key: the MCP server namespace. Updates never rename it. */
  serverName: string
  transport: McpTransport
  /** stdio only. */
  command?: string
  /** stdio only. */
  args?: string[]
  /** stdio only. Values support `env:NAME` process.env references. */
  env?: Record<string, string>
  /** streamable-http only. */
  url?: string
  /** streamable-http only. Values support `env:NAME` process.env references. */
  headers?: Record<string, string>
  /** Defaults to true on create; updates preserve the current value when omitted. */
  enabled?: boolean
}

/** Body of POST /servers/import: a JSON document as text. */
export interface ImportRequest {
  json: string
}

/** One entry skipped during import, with the reason it was ignored. */
export interface ImportSkipped {
  name: string
  reason: string
}

/** Data returned by POST /servers/import. */
export interface ImportPayload {
  imported: InstalledServer[]
  skipped: ImportSkipped[]
}

export interface ToggleRequest {
  serverName: string
  enabled: boolean
}

export interface TestRequest {
  serverName: string
}

export interface SmokeRequest {
  serverName: string
  /** Optional tool override; defaults to the preset's smoke tool. */
  tool?: string
  args?: Record<string, unknown>
}

/** Envelope returned by every API route. */
export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

/** Route payloads. */
export interface CatalogPayload {
  /** Merged presets from every enabled source; each carries sourceId/sourceName/uid. */
  catalog: CatalogFile
  servers: InstalledServer[]
  sources: MarketSource[]
}

/** Data returned by GET /sources and POST /sources/refresh. */
export interface MarketSourcesPayload {
  sources: MarketSource[]
}

/** Data returned by POST /sources. */
export interface MarketSourcePayload {
  source: MarketSource
}

/** Data returned by DELETE /sources. */
export interface RemoveSourcePayload {
  removed: boolean
}

/** Data returned by GET /settings and POST /settings. */
export interface SettingsPayload {
  settings: StationSettings
}

export interface ServersPayload {
  servers: InstalledServer[]
}

export interface InstallPayload {
  server: InstalledServer
}

/** Data returned by POST /servers/custom and POST /servers/custom/update. */
export interface CustomServerPayload {
  server: InstalledServer
}

export interface ProbePayload {
  result: ProbeResult
}

export interface SmokePayload {
  result: SmokeResult
}

export interface TogglePayload {
  server: InstalledServer
}

export interface RemovePayload {
  removed: boolean
}

export interface DoctorPayload {
  checks: DoctorCheck[]
}
