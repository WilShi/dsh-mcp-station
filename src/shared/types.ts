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
}

export interface CatalogFile {
  version: number
  updated: string
  presets: CatalogPreset[]
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
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
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
  /** Override the preset serverName (must be unique). */
  serverName?: string
  values?: Record<string, string>
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
  catalog: CatalogFile
  servers: InstalledServer[]
}

export interface ServersPayload {
  servers: InstalledServer[]
}

export interface InstallPayload {
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
