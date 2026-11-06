/**
 * Typed fetch helpers for the MCP Station host API.
 *
 * Every route answers `{ ok: true, data }` or `{ ok: false, error }`; this
 * module unwraps the envelope and throws {@link ApiError} for the failure case
 * so callers can render one error path. Messages are redacted before they reach
 * the UI so a secret pasted into a field can never bounce back on screen.
 */

import type {
  ApiResponse,
  CatalogPayload,
  CustomServerPayload,
  CustomServerRequest,
  DoctorPayload,
  ImportPayload,
  InstallPayload,
  InstallRequest,
  InstalledServer,
  ProbePayload,
  ProbeResult,
  RemovePayload,
  ServersPayload,
  StationStatus,
  TogglePayload,
  ToggleRequest,
} from '../shared/types.ts'

const BASE = '/mcp-station/api'

/** Failure raised for transport, HTTP or envelope errors. */
export class ApiError extends Error {
  /** Stable machine code (`network`, `bad-response` or the host code). */
  readonly code: string
  /** HTTP status; 0 when the request never reached the host. */
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/Bearer\s+[^\s,;]+/giu, 'Bearer [redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, '[redacted]'],
  [/\b(sk|pk|tvly|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/gu, '[redacted]'],
  [/((?:api[-_ ]?key|token|secret|password|authorization)\s*[:=]\s*)\S+/giu, '$1[redacted]'],
]

/**
 * Remove credential-shaped substrings from text that is about to be displayed.
 * @param text - raw message from the network or the host.
 * @returns the message with secrets masked.
 */
export function redact(text: string): string {
  let value = text
  for (const [pattern, replacement] of SECRET_PATTERNS) value = value.replace(pattern, replacement)
  return value
}

/**
 * Human-readable message for any thrown value.
 * @param cause - thrown value.
 * @param fallback - text used when no message is available.
 * @returns a redacted, non-empty message.
 */
export function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) return redact(cause.message)
  if (cause instanceof Error) return redact(cause.message)
  const text = String(cause)
  return redact(text === '' ? fallback : text)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(BASE + path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      ...init,
    })
  } catch (cause) {
    throw new ApiError('network', cause instanceof Error ? cause.message : String(cause), 0)
  }

  const text = await response.text()
  let body: ApiResponse<T> | null = null
  try {
    body = text === '' ? null : (JSON.parse(text) as ApiResponse<T>)
  } catch {
    body = null
  }

  if (body === null) {
    throw new ApiError(
      'bad-response',
      response.status === 0 ? 'empty response' : `HTTP ${String(response.status)}`,
      response.status,
    )
  }
  if (!body.ok) {
    throw new ApiError(body.error.code, body.error.message, response.status)
  }
  return body.data
}

/**
 * Merge a probe result into an installed row.
 * @param server - row to update.
 * @param result - probe outcome.
 * @returns a new row carrying status, tools, latency and error.
 */
export function applyProbe(server: InstalledServer, result: ProbeResult): InstalledServer {
  const next: InstalledServer = {
    ...server,
    status: result.ok ? 'connected' : 'error',
    tools: result.tools,
    toolCount: result.toolCount,
    latencyMs: result.latencyMs,
    lastCheckedAt: new Date().toISOString(),
  }
  if (result.error === undefined || result.error === '') delete next.error
  else next.error = result.error
  return next
}

/** GET /status — plugin, profile, Chrome and Playwright facts. */
export function fetchStatus(): Promise<StationStatus> {
  return request<StationStatus>('/status')
}

/** GET /catalog — bundled presets merged with installed rows. */
export function fetchCatalog(): Promise<CatalogPayload> {
  return request<CatalogPayload>('/catalog')
}

/** GET /servers — installed rows only. */
export function fetchServers(): Promise<ServersPayload> {
  return request<ServersPayload>('/servers')
}

/** GET /doctor — environment checks. */
export function fetchDoctor(): Promise<DoctorPayload> {
  return request<DoctorPayload>('/doctor')
}

/** POST /servers/install — write one managed row (optionally probed). */
export function installServer(body: InstallRequest): Promise<InstallPayload> {
  return request<InstallPayload>('/servers/install', { method: 'POST', body: JSON.stringify(body) })
}

/** POST /servers/custom — write one custom stdio or HTTP server row. */
export function createCustomServer(body: CustomServerRequest): Promise<CustomServerPayload> {
  return request<CustomServerPayload>('/servers/custom', { method: 'POST', body: JSON.stringify(body) })
}

/** POST /servers/custom/update — rewrite one custom server row. */
export function updateCustomServer(body: CustomServerRequest): Promise<CustomServerPayload> {
  return request<CustomServerPayload>('/servers/custom/update', { method: 'POST', body: JSON.stringify(body) })
}

/** POST /servers/import — install servers from a Claude/Cursor style document. */
export function importServers(json: string): Promise<ImportPayload> {
  return request<ImportPayload>('/servers/import', { method: 'POST', body: JSON.stringify({ json }) })
}

/** POST /servers/test — probe one server and list its tools. */
export function testServer(serverName: string): Promise<ProbePayload> {
  return request<ProbePayload>('/servers/test', { method: 'POST', body: JSON.stringify({ serverName }) })
}

/** POST /servers/toggle — enable or disable one managed row. */
export function toggleServer(body: ToggleRequest): Promise<TogglePayload> {
  return request<TogglePayload>('/servers/toggle', { method: 'POST', body: JSON.stringify(body) })
}

/** DELETE /servers?name= — remove one managed row. */
export function removeServer(serverName: string): Promise<RemovePayload> {
  return request<RemovePayload>(`/servers?name=${encodeURIComponent(serverName)}`, { method: 'DELETE' })
}
