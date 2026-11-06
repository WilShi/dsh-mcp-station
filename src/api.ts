/**
 * HTTP API for MCP Station. Routes are documented in docs/API.md.
 * All handlers answer JSON envelopes; mutating methods require a same-origin
 * or non-browser request.
 */

import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  findPreset,
  findPresetForServer,
  loadCatalog,
  resolvePresetRow,
  uniqueServerName,
} from './catalog.ts'
import type { TemplateVars } from './catalog.ts'
import type { Config } from './index.ts'
import { callStdioTool, probeHttp, probeStdio, resolveEnvValues } from './mcp/probe.ts'
import type { ProbeOutcome } from './mcp/probe.ts'
import {
  MANAGED_ID_PREFIX,
  addManagedRow,
  installedFromServer,
  inspectPatchText,
  isValidServerName,
  parsePatchRows,
  readPatchText,
  removeManagedRow,
  setManagedRowEnabled,
  writePatchTextAtomic,
} from './patch.ts'
import type { ManagedRowInput, PatchRow } from './patch.ts'
import { resolveStationPaths } from './paths.ts'
import { detectChrome, detectDshVersion, playwrightBrowserCache } from './runtime.ts'
import type {
  ApiResponse,
  CatalogFile,
  CatalogPayload,
  DoctorCheck,
  DoctorPayload,
  InstallPayload,
  InstalledServer,
  ProbePayload,
  ProbeResult,
  RemovePayload,
  ServersPayload,
  SmokePayload,
  SmokeResult,
  StationStatus,
  TogglePayload,
} from './shared/types.ts'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const API_PREFIX = '/mcp-station/api'
const DEFAULT_MAX_BODY_BYTES = 256 * 1024
const DEFAULT_PROBE_TIMEOUT_MS = 90_000

type StationPaths = ReturnType<typeof resolveStationPaths>
type ProbeCacheEntry = { result: ProbeResult; at: number }

/** API failure carrying one HTTP status and a stable machine code. */
class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

function fail(res: ServerResponse, status: number, code: string, message: string): void {
  const body: ApiResponse<never> = { ok: false, error: { code, message } }
  sendJson(res, status, body)
}

function sendData(res: ServerResponse, data: unknown, status = 200): void {
  sendJson(res, status, { ok: true, data })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new ApiError(413, 'payload-too-large', '请求体超过 ' + String(limit) + ' 字节')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new ApiError(400, 'invalid-json', '请求体必须是合法 JSON')
  }
  if (!isRecord(parsed)) throw new ApiError(400, 'invalid-body', '请求体必须是 JSON 对象')
  return parsed
}

function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const host = req.headers.host
    return host !== undefined && new URL(origin).host === host
  } catch {
    return false
  }
}

function normalizeRoute(pathname: string): string {
  const withoutPrefix = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) : pathname
  const route = withoutPrefix.replace(/\/+$/, '')
  return route === '' ? '/' : route
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'invalid-request', '缺少字段或不是字符串: ' + key)
  }
  return value.trim()
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new ApiError(400, 'invalid-request', '字段 ' + key + ' 必须是字符串')
  return value.trim()
}

function requireBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key]
  if (typeof value !== 'boolean') throw new ApiError(400, 'invalid-request', '字段 ' + key + ' 必须是布尔值')
  return value
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) throw new ApiError(400, 'invalid-request', label + ' 必须是对象')
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new ApiError(400, 'invalid-request', label + '.' + key + ' 必须是字符串')
    out[key] = item
  }
  return out
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) throw new ApiError(400, 'invalid-request', label + ' 必须是对象')
  return value
}

function toProbeResult(outcome: ProbeOutcome): ProbeResult {
  return {
    ok: outcome.ok,
    tools: outcome.tools,
    toolCount: outcome.tools.length,
    latencyMs: outcome.latencyMs,
    ...(outcome.serverInfo === undefined ? {} : { serverInfo: outcome.serverInfo }),
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  }
}

/**
 * Build the HTTP handler mounted at /mcp-station/api.
 * @param _ctx - host context (reserved for future host services).
 * @param config - validated plugin configuration.
 * @returns the node:http handler.
 */
export function makeApiHandler(_ctx: Context, config: Config): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const probeTimeoutMs = config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const probeCache = new Map<string, ProbeCacheEntry>()

  const resolvePaths = (): StationPaths =>
    resolveStationPaths({ dshHome: config.dshHome, profile: config.profile, workspace: config.workspace })

  async function readRows(): Promise<{ paths: StationPaths; text: string; rows: PatchRow[] }> {
    const paths = resolvePaths()
    const { text } = await readPatchText(paths.patchPath)
    const rows = parsePatchRows(text)
    return { paths, text, rows }
  }

  async function loadCatalogOrFail(): Promise<CatalogFile> {
    try {
      return await loadCatalog()
    } catch (error) {
      throw new ApiError(500, 'catalog', '内置预设目录读取失败: ' + errorMessage(error))
    }
  }

  function withRuntime(server: InstalledServer, entry: ProbeCacheEntry | undefined): InstalledServer {
    if (!server.enabled) return { ...server, status: 'disabled' }
    if (entry === undefined) return server
    return {
      ...server,
      status: entry.result.ok ? 'connected' : 'error',
      toolCount: entry.result.tools.length,
      tools: entry.result.tools,
      latencyMs: entry.result.latencyMs,
      lastCheckedAt: new Date(entry.at).toISOString(),
      ...(entry.result.error === undefined ? {} : { error: entry.result.error }),
    }
  }

  async function listServers(): Promise<InstalledServer[]> {
    const { rows } = await readRows()
    const catalog = await loadCatalogOrFail()
    return rows.map((row) => withRuntime(installedFromServer(row, catalog), probeCache.get(row.serverName)))
  }

  function locateRow(rows: PatchRow[], serverName: string): PatchRow {
    const matches = rows.filter((row) => row.serverName === serverName)
    const station = matches.find((row) => row.origin === 'station')
    if (station !== undefined) return station
    if (matches.length > 0) {
      throw new ApiError(403, 'read-only', '外部 MCP 行由其他配置维护，MCP Station 只读: ' + serverName)
    }
    throw new ApiError(404, 'not-found', '找不到 MCP server: ' + serverName)
  }

  async function probeRow(row: PatchRow): Promise<ProbeResult> {
    let outcome: ProbeOutcome
    try {
      if (row.transport === 'streamable-http') {
        if (row.url === undefined || row.url === '') throw new Error('缺少 url')
        const headers = resolveEnvValues(row.headers)
        outcome = await probeHttp({
          url: row.url,
          ...(Object.keys(headers).length === 0 ? {} : { headers }),
          timeoutMs: probeTimeoutMs,
        })
      } else {
        if (row.command === undefined || row.command === '') throw new Error('缺少 command')
        const env = resolveEnvValues(row.env)
        outcome = await probeStdio({ command: row.command, args: row.args ?? [], env, timeoutMs: probeTimeoutMs })
      }
    } catch (error) {
      outcome = { ok: false, tools: [], latencyMs: 0, error: errorMessage(error) }
    }
    return toProbeResult(outcome)
  }

  async function handleStatus(): Promise<StationStatus> {
    const catalog = await loadCatalogOrFail()
    const paths = resolvePaths()
    const { text } = await readPatchText(paths.patchPath)
    const warnings: string[] = []
    let rows: PatchRow[] = []
    const validation = inspectPatchText(text)
    if (text.trim() === '') {
      warnings.push('cordis.patch.yml 为空或不存在: ' + paths.patchPath)
    } else if (!validation.ok) {
      warnings.push('cordis.patch.yml 校验失败: ' + (validation.error ?? 'unknown'))
    } else {
      try {
        rows = parsePatchRows(text)
      } catch (error) {
        warnings.push('MCP 行无法读取: ' + errorMessage(error))
      }
    }
    const chrome = detectChrome()
    if (!chrome.available) warnings.push('未检测到本地 Chrome/Chromium，浏览器预设可能无法启动')
    return {
      pluginVersion: '0.1.0',
      dshVersion: detectDshVersion(),
      profile: paths.profile,
      profileDir: paths.profileDir,
      patchPath: paths.patchPath,
      catalogVersion: catalog.version,
      catalogUpdated: catalog.updated,
      presetCount: catalog.presets.length,
      installedCount: rows.length,
      chrome,
      playwrightBrowsers: playwrightBrowserCache(),
      warnings,
    }
  }

  async function handleCatalog(): Promise<CatalogPayload> {
    const catalog = await loadCatalogOrFail()
    const { rows } = await readRows()
    return {
      catalog,
      servers: rows.map((row) => withRuntime(installedFromServer(row, catalog), probeCache.get(row.serverName))),
    }
  }

  async function handleServers(): Promise<ServersPayload> {
    return { servers: await listServers() }
  }

  async function handleInstall(body: Record<string, unknown>): Promise<InstallPayload> {
    const presetId = requireString(body, 'presetId')
    const requestedName = optionalString(body, 'serverName')
    const values = stringRecord(body.values, 'values')
    const catalog = await loadCatalogOrFail()
    const preset = findPreset(catalog, presetId)
    if (preset === undefined) throw new ApiError(404, 'not-found', '未知预设: ' + presetId)
    const { paths, text, rows } = await readRows()
    const vars: TemplateVars = {
      workspace: paths.workspace,
      dshHome: paths.dshHome,
      profile: paths.profile,
    }
    let row: ManagedRowInput
    try {
      row = resolvePresetRow(preset, values, vars)
    } catch (error) {
      throw new ApiError(400, 'invalid-input', errorMessage(error))
    }
    const taken = rows.map((item) => item.serverName)
    const explicitName = requestedName !== undefined && requestedName !== ''
    let serverName = explicitName ? requestedName! : preset.serverName
    if (!isValidServerName(serverName)) {
      throw new ApiError(400, 'invalid-input', 'serverName 必须是 1-32 位字母、数字、下划线或连字符')
    }
    if (explicitName) {
      if (taken.some((name) => name.toLowerCase() === serverName.toLowerCase())) {
        throw new ApiError(409, 'conflict', 'serverName 已存在: ' + serverName)
      }
    } else {
      serverName = uniqueServerName(serverName, taken)
    }
    row.serverName = serverName
    row.id = MANAGED_ID_PREFIX + serverName
    let next: string
    try {
      next = addManagedRow(text, row)
    } catch (error) {
      const message = errorMessage(error)
      if (/已存在|重复/.test(message)) throw new ApiError(409, 'conflict', message)
      throw new ApiError(500, 'patch-invalid', message)
    }
    try {
      await writePatchTextAtomic(paths.patchPath, next, { requireBlock: true })
    } catch (error) {
      throw new ApiError(500, 'patch-write', '写入 cordis.patch.yml 失败: ' + errorMessage(error))
    }
    // Syntax self-check: re-read the file and parse it before answering.
    const written = await readPatchText(paths.patchPath)
    const check = inspectPatchText(written.text, { requireBlock: true })
    if (!check.ok) throw new ApiError(500, 'patch-invalid', '写入后自检失败: ' + (check.error ?? 'unknown'))
    const stored = parsePatchRows(written.text).find(
      (item) => item.origin === 'station' && item.serverName === serverName,
    )
    if (stored === undefined) throw new ApiError(500, 'patch-invalid', '写入后找不到新行: ' + serverName)
    return { server: installedFromServer(stored, catalog) }
  }

  async function handleTest(body: Record<string, unknown>): Promise<ProbePayload> {
    const serverName = requireString(body, 'serverName')
    const { rows } = await readRows()
    const matches = rows.filter((row) => row.serverName === serverName)
    const row = matches.find((item) => item.origin === 'station') ?? matches[0]
    if (row === undefined) throw new ApiError(404, 'not-found', '找不到 MCP server: ' + serverName)
    const result = await probeRow(row)
    probeCache.set(serverName, { result, at: Date.now() })
    return { result }
  }

  async function handleToggle(body: Record<string, unknown>): Promise<TogglePayload> {
    const serverName = requireString(body, 'serverName')
    const enabled = requireBoolean(body, 'enabled')
    const catalog = await loadCatalogOrFail()
    const { paths, text, rows } = await readRows()
    locateRow(rows, serverName)
    let next: string
    try {
      next = setManagedRowEnabled(text, serverName, enabled)
    } catch (error) {
      throw new ApiError(500, 'patch-invalid', errorMessage(error))
    }
    try {
      await writePatchTextAtomic(paths.patchPath, next, { requireBlock: true })
    } catch (error) {
      throw new ApiError(500, 'patch-write', '写入 cordis.patch.yml 失败: ' + errorMessage(error))
    }
    const after = parsePatchRows((await readPatchText(paths.patchPath)).text)
    const stored = after.find((item) => item.origin === 'station' && item.serverName === serverName)
    if (stored === undefined) throw new ApiError(500, 'patch-invalid', '写入后找不到受管行: ' + serverName)
    return { server: withRuntime(installedFromServer(stored, catalog), probeCache.get(serverName)) }
  }

  async function handleDelete(name: string): Promise<RemovePayload> {
    if (name === '') throw new ApiError(400, 'invalid-request', '缺少查询参数 name')
    const { paths, text, rows } = await readRows()
    locateRow(rows, name)
    let next: string
    try {
      next = removeManagedRow(text, name)
    } catch (error) {
      throw new ApiError(500, 'patch-invalid', errorMessage(error))
    }
    try {
      await writePatchTextAtomic(paths.patchPath, next, { requireBlock: false })
    } catch (error) {
      throw new ApiError(500, 'patch-write', '写入 cordis.patch.yml 失败: ' + errorMessage(error))
    }
    probeCache.delete(name)
    return { removed: true }
  }

  async function handleSmoke(body: Record<string, unknown>): Promise<SmokePayload> {
    const serverName = requireString(body, 'serverName')
    const overrideTool = optionalString(body, 'tool')
    const overrideArgs = optionalRecord(body.args, 'args')
    const catalog = await loadCatalogOrFail()
    const { rows } = await readRows()
    const matches = rows.filter((row) => row.serverName === serverName)
    const row = matches.find((item) => item.origin === 'station') ?? matches[0]
    if (row === undefined) throw new ApiError(404, 'not-found', '找不到 MCP server: ' + serverName)
    const preset = findPresetForServer(catalog, serverName)
    const smoke = preset?.smoke
    const tool = overrideTool !== undefined && overrideTool !== '' ? overrideTool : smoke?.tool
    if (tool === undefined || tool === '') {
      throw new ApiError(400, 'smoke-unavailable', '该 MCP server 没有配置 smoke 测试')
    }
    const started = Date.now()
    if (row.transport === 'streamable-http') {
      return { result: { ok: false, tool, latencyMs: Date.now() - started, error: 'smoke 目前只支持 stdio MCP server' } }
    }
    if (row.command === undefined || row.command === '') {
      return { result: { ok: false, tool, latencyMs: Date.now() - started, error: '缺少 command' } }
    }
    let env: Record<string, string>
    try {
      env = resolveEnvValues(row.env)
    } catch (error) {
      return { result: { ok: false, tool, latencyMs: Date.now() - started, error: errorMessage(error) } }
    }
    const toolArgs = overrideArgs ?? smoke?.args
    const outcome = await callStdioTool({
      command: row.command,
      args: row.args ?? [],
      env,
      tool,
      ...(toolArgs === undefined ? {} : { toolArgs }),
      timeoutMs: Math.max(probeTimeoutMs, 30_000),
    })
    const expect = smoke?.expectContains
    let ok = outcome.ok
    let failure = outcome.error
    if (ok && typeof expect === 'string' && expect !== '' && !outcome.text.toLowerCase().includes(expect.toLowerCase())) {
      ok = false
      failure = '结果中未找到预期文本: ' + expect
    }
    const result: SmokeResult = {
      ok,
      tool,
      latencyMs: outcome.latencyMs,
      ...(outcome.text === '' ? {} : { output: outcome.text.slice(0, 4000) }),
      ...(failure === undefined ? {} : { error: failure }),
    }
    return { result }
  }

  async function handleDoctor(): Promise<DoctorPayload> {
    const checks: DoctorCheck[] = []
    checks.push({
      id: 'node',
      label: { zh: 'Node.js 运行时', en: 'Node.js runtime' },
      ok: true,
      detail: process.version,
    })
    let paths: StationPaths
    try {
      paths = resolvePaths()
    } catch (error) {
      checks.push({
        id: 'profile',
        label: { zh: 'DSH Profile', en: 'DSH profile' },
        ok: false,
        detail: errorMessage(error),
        hint: { zh: '确认 DSH Home 下至少有一个 profile', en: 'Make sure DSH Home contains a profile.' },
      })
      return { checks }
    }
    checks.push({
      id: 'profile',
      label: { zh: 'DSH Profile', en: 'DSH profile' },
      ok: existsSync(paths.profileDir),
      detail: paths.profile + ' (' + paths.profileDir + ')',
      hint: { zh: 'profile 目录不存在时无法写入 MCP 配置', en: 'MCP rows cannot be written without a profile.' },
    })
    let patchText = ''
    let patchExists = false
    try {
      const read = await readPatchText(paths.patchPath)
      patchText = read.text
      patchExists = read.exists
    } catch (error) {
      checks.push({
        id: 'patch-parse',
        label: { zh: 'cordis.patch.yml 可解析', en: 'cordis.patch.yml parses' },
        ok: false,
        detail: errorMessage(error),
      })
    }
    if (patchExists) {
      const validation = inspectPatchText(patchText)
      checks.push({
        id: 'patch-parse',
        label: { zh: 'cordis.patch.yml 可解析', en: 'cordis.patch.yml parses' },
        ok: validation.ok,
        detail: validation.ok ? 'YAML 解析通过' : (validation.error ?? 'unknown'),
        hint: {
          zh: '解析失败的配置不会被 MCP Station 改写；请先修复 YAML 语法',
          en: 'MCP Station never rewrites an unparsable file; fix the YAML first.',
        },
      })
    } else if (patchText === '') {
      checks.push({
        id: 'patch-parse',
        label: { zh: 'cordis.patch.yml 可解析', en: 'cordis.patch.yml parses' },
        ok: true,
        detail: '文件不存在（首次安装时创建）',
      })
    }
    let rows: PatchRow[] = []
    let rowsError: string | undefined
    if (patchExists) {
      try {
        const validation = inspectPatchText(patchText)
        if (validation.ok) rows = parsePatchRows(patchText)
      } catch (error) {
        rowsError = errorMessage(error)
      }
    }
    const stationCount = rows.filter((row) => row.origin === 'station').length
    const externalCount = rows.filter((row) => row.origin === 'external').length
    const hasBlock = inspectPatchText(patchText).hasBlock
    checks.push({
      id: 'managed-block',
      label: { zh: 'MCP Station 受管块', en: 'MCP Station managed block' },
      ok: rowsError === undefined && (hasBlock || stationCount === 0),
      detail:
        rowsError !== undefined
          ? rowsError
          : hasBlock
            ? '已存在，' + String(stationCount) + ' 条受管行，' + String(externalCount) + ' 条外部行'
            : '尚未创建（首次安装时写入）',
      hint: {
        zh: '受管块只由 MCP Station 维护；块外行只读',
        en: 'Only MCP Station maintains the block; rows outside stay read-only.',
      },
    })
    try {
      const catalog = await loadCatalog()
      checks.push({
        id: 'catalog',
        label: { zh: '内置预设目录', en: 'Bundled preset catalog' },
        ok: true,
        detail: String(catalog.presets.length) + ' 个预设（v' + String(catalog.version) + '，更新于 ' + catalog.updated + '）',
      })
    } catch (error) {
      checks.push({
        id: 'catalog',
        label: { zh: '内置预设目录', en: 'Bundled preset catalog' },
        ok: false,
        detail: errorMessage(error),
      })
    }
    const chrome = detectChrome()
    checks.push({
      id: 'chrome',
      label: { zh: 'Chrome/Chromium', en: 'Chrome/Chromium' },
      ok: chrome.available,
      detail: chrome.available
        ? (chrome.path ?? 'detected') + (chrome.version === undefined ? '' : ' ' + chrome.version)
        : '未检测到本地 Chrome/Chromium',
      hint: {
        zh: '浏览器预设需要 Chrome 或 Chromium 内核浏览器',
        en: 'Browser presets need a Chrome-family browser.',
      },
    })
    checks.push({
      id: 'workspace',
      label: { zh: '工作区目录', en: 'Workspace directory' },
      ok: existsSync(paths.workspace),
      detail: paths.workspace,
    })
    return { checks }
  }

  return async (req, res) => {
    try {
      const method = req.method ?? 'GET'
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const route = normalizeRoute(url.pathname)
      if (method !== 'GET' && method !== 'HEAD' && !isSameOrigin(req)) {
        throw new ApiError(403, 'forbidden', 'cross-origin request refused')
      }
      if (method === 'GET') {
        if (route === '/status') {
          sendData(res, await handleStatus())
          return
        }
        if (route === '/catalog') {
          sendData(res, await handleCatalog())
          return
        }
        if (route === '/servers') {
          sendData(res, await handleServers())
          return
        }
        if (route === '/doctor') {
          sendData(res, await handleDoctor())
          return
        }
        throw new ApiError(404, 'not-found', '未知路由: GET ' + route)
      }
      if (method === 'POST') {
        const body = await readJsonBody(req, maxBodyBytes)
        if (route === '/servers/install') {
          sendData(res, await handleInstall(body))
          return
        }
        if (route === '/servers/test') {
          sendData(res, await handleTest(body))
          return
        }
        if (route === '/servers/toggle') {
          sendData(res, await handleToggle(body))
          return
        }
        if (route === '/servers/smoke') {
          sendData(res, await handleSmoke(body))
          return
        }
        throw new ApiError(404, 'not-found', '未知路由: POST ' + route)
      }
      if (method === 'DELETE') {
        if (route === '/servers') {
          sendData(res, await handleDelete(url.searchParams.get('name') ?? ''))
          return
        }
        throw new ApiError(404, 'not-found', '未知路由: DELETE ' + route)
      }
      throw new ApiError(405, 'method-not-allowed', '不支持的 HTTP 方法: ' + method)
    } catch (error) {
      if (res.writableEnded) return
      if (error instanceof ApiError) {
        fail(res, error.status, error.code, error.message)
        return
      }
      fail(res, 500, 'internal', errorMessage(error))
    }
  }
}
