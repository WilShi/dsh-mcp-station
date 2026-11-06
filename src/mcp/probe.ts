/**
 * MCP connectivity probe: spawn a stdio server or open a streamable HTTP session.
 *
 * The stdio path speaks JSON-RPC 2.0 over newline-delimited stdout/stderr,
 * without pulling the MCP SDK into this plugin: initialize, then
 * notifications/initialized, then tools/list (and tools/call for smoke tests).
 *
 * Child environments start from a scrubbed parent environment (no DSH_* names,
 * no *KEY* / *TOKEN* / *SECRET* / *PASSWORD* names); explicit env wins.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { EnvEntry, PatchEnv } from '../patch.ts'
import type { ToolSummary } from '../shared/types.ts'

/** Options for one stdio probe. */
export interface StdioProbeOptions {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  timeoutMs?: number
}

/** Options for one streamable HTTP probe. */
export interface HttpProbeOptions {
  url: string
  headers?: Record<string, string>
  timeoutMs?: number
}

/** Result of a reachability probe. */
export interface ProbeOutcome {
  ok: boolean
  tools: ToolSummary[]
  serverInfo?: { name?: string; version?: string }
  latencyMs: number
  error?: string
}

/** Options for one stdio tool call. */
export interface CallToolOptions extends StdioProbeOptions {
  tool: string
  toolArgs?: Record<string, unknown>
}

/** Result of one stdio tool call. */
export interface CallToolResult {
  ok: boolean
  text: string
  latencyMs: number
  error?: string
}

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_STDOUT_BUFFER = 2 * 1024 * 1024
const MAX_DIAGNOSTIC_BYTES = 16 * 1024
const MAX_TOOL_TEXT = 20_000
const SCRUBBED_NAME_RE = /(KEY|PASSWORD|SECRET|TOKEN)/i
const CLIENT_INFO = { name: 'dsh-mcp-station', version: '0.1.0' }
const PROTOCOL_VERSION = '2025-06-18'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function appendBounded(current: string, chunk: string): string {
  const next = current + chunk
  return next.length > MAX_DIAGNOSTIC_BYTES ? next.slice(next.length - MAX_DIAGNOSTIC_BYTES) : next
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
}

function truncate(value: string, limit = 400): string {
  const oneLine = stripAnsi(value).replace(/\s+/g, ' ').trim()
  return oneLine.length > limit ? oneLine.slice(0, limit) + '...' : oneLine
}

/** Copy the parent environment without DSH_* names and credential-shaped names. */
export function scrubbedParentEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (/^DSH_/i.test(key)) continue
    if (SCRUBBED_NAME_RE.test(key)) continue
    result[key] = value
  }
  return result
}

/** Merge explicit env over the scrubbed parent environment; explicit wins. */
export function buildChildEnv(explicit: Record<string, string> | undefined): Record<string, string> {
  const env = scrubbedParentEnv()
  for (const [key, value] of Object.entries(explicit ?? {})) {
    if (value === undefined) continue
    env[key] = value
  }
  return env
}

/** Evaluate a !!js expression with a process/globalThis scope, like the loader does. */
export function evaluateJsExpression(expression: string): unknown {
  return new Function('ctx', 'with (ctx) { return eval(' + JSON.stringify(expression) + ') }')({
    process,
    globalThis,
    Buffer,
  })
}

/**
 * Resolve env values from a managed / external patch row.
 * - env:NAME reads process.env.NAME at probe time (never written to disk);
 * - { js } evaluates a raw !!js expression;
 * - plain strings are literals.
 */
export function resolveEnvValues(
  env: PatchEnv | undefined,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(env ?? {})) {
    const value = resolveEnvEntry(key, entry, parent)
    if (value !== undefined) result[key] = value
  }
  return result
}

function resolveEnvEntry(key: string, entry: EnvEntry, parent: NodeJS.ProcessEnv): string | undefined {
  if (typeof entry === 'string') {
    const ref = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(entry)
    if (ref === null) return entry
    return parent[ref[1]!]
  }
  let value: unknown
  try {
    value = evaluateJsExpression(entry.js)
  } catch (error) {
    throw new Error('环境变量 ' + key + ' 的 !!js 表达式求值失败: ' + errorMessage(error))
  }
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' ? value : String(value)
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface SessionOptions {
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  timeoutMs: number
}

/** Minimal JSON-RPC 2.0 client speaking newline-delimited JSON over child stdio. */
class StdioJsonRpcSession {
  private readonly child: ChildProcess
  private readonly timeoutMs: number
  private readonly deadline: number
  private readonly pending = new Map<number, Pending>()
  private readonly diagnostics: string[] = []
  private readonly stderrChunks: string[] = []
  private buffer = ''
  private nextId = 1
  private closed = false
  private spawnError: Error | undefined
  serverInfo: { name?: string; version?: string } | undefined

  constructor(options: SessionOptions) {
    this.timeoutMs = options.timeoutMs
    this.deadline = Date.now() + options.timeoutMs
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      shell: process.platform === 'win32',
      windowsHide: true,
    })
    this.child = child
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.onStdout(chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      const current = this.stderrChunks.join('')
      this.stderrChunks.length = 0
      this.stderrChunks.push(appendBounded(current, chunk))
    })
    child.stdin?.on('error', () => {})
    child.on('error', (error) => {
      this.spawnError = error
      this.rejectAll(error)
    })
    child.on('exit', (code, signal) => {
      if (this.closed) return
      this.rejectAll(
        new Error('MCP server 进程退出（code=' + String(code) + ', signal=' + String(signal) + '）' + this.stderrSuffix()),
      )
    })
  }

  private remaining(): number {
    return this.deadline - Date.now()
  }

  private timeoutError(): Error {
    return new Error('MCP 连接超时（' + String(this.timeoutMs) + 'ms）' + this.stderrSuffix())
  }

  private stderrSuffix(): string {
    const tail = this.stderrTail()
    return tail === '' ? '' : '\nstderr: ' + tail
  }

  stderrTail(): string {
    const text = stripAnsi(this.stderrChunks.join('')).trim()
    return text.length > 2000 ? text.slice(text.length - 2000) : text
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  private write(message: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const stdin = this.child.stdin
      if (this.spawnError !== undefined) {
        reject(this.spawnError)
        return
      }
      if (stdin === null) {
        reject(new Error('MCP server stdin 不可用'))
        return
      }
      stdin.write(JSON.stringify(message) + '\n', (error) => {
        if (error !== null && error !== undefined) reject(error)
        else resolve()
      })
    })
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > MAX_STDOUT_BUFFER) {
      this.buffer = ''
      this.rejectAll(new Error('MCP server 输出超过 ' + String(MAX_STDOUT_BUFFER) + ' 字节' + this.stderrSuffix()))
      return
    }
    for (;;) {
      const index = this.buffer.indexOf('\n')
      if (index < 0) break
      const line = this.buffer.slice(0, index).replace(/\r$/, '').trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line !== '') this.onLine(line)
    }
  }

  private onLine(line: string): void {
    let message: Record<string, unknown>
    try {
      const parsed = JSON.parse(line) as unknown
      const record = asRecord(parsed)
      if (record === undefined) throw new Error('not an object')
      message = record
    } catch {
      this.diagnostics.push(line)
      return
    }
    if (typeof message.method === 'string') {
      if (typeof message.id === 'number' || typeof message.id === 'string') {
        void this.write({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Method not found' },
        }).catch(() => {})
      }
      return
    }
    const rawId = message.id
    if (typeof rawId !== 'number' && typeof rawId !== 'string') return
    const id = typeof rawId === 'number' ? rawId : Number(rawId)
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    const rpcError = asRecord(message.error)
    if (rpcError !== undefined) {
      const code = typeof rpcError.code === 'number' ? rpcError.code : -32603
      const detail = typeof rpcError.message === 'string' ? rpcError.message : JSON.stringify(rpcError)
      pending.reject(new Error('MCP 错误 ' + String(code) + ': ' + detail))
      return
    }
    pending.resolve(message.result)
  }

  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const remaining = this.remaining()
    if (remaining <= 0) return Promise.reject(this.timeoutError())
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(this.timeoutError())
      }, Math.max(1, remaining))
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }).catch((error: unknown) => {
        const pending = this.pending.get(id)
        if (pending !== undefined) {
          this.pending.delete(id)
          clearTimeout(pending.timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    try {
      await this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
    } catch {
      // A closed stdin after a successful response must not fail the probe.
    }
  }

  async initialize(): Promise<void> {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    })
    const record = asRecord(result)
    const info = asRecord(record?.serverInfo)
    if (info !== undefined) {
      const serverInfo: { name?: string; version?: string } = {}
      if (typeof info.name === 'string') serverInfo.name = info.name
      if (typeof info.version === 'string') serverInfo.version = info.version
      this.serverInfo = serverInfo
    }
    await this.notify('notifications/initialized')
  }

  async listTools(): Promise<ToolSummary[]> {
    const tools: ToolSummary[] = []
    let cursor: string | undefined
    for (let page = 0; page < 50; page += 1) {
      const result = await this.request('tools/list', cursor === undefined ? {} : { cursor })
      const record = asRecord(result)
      const list = Array.isArray(record?.tools) ? record.tools : []
      for (const item of list) {
        const tool = asRecord(item)
        if (tool === undefined || typeof tool.name !== 'string') continue
        const summary: ToolSummary = { name: tool.name }
        if (typeof tool.description === 'string') summary.description = tool.description
        if (tool.inputSchema !== undefined) summary.inputSchema = tool.inputSchema
        if (isDangerousToolName(tool.name)) summary.dangerous = true
        tools.push(summary)
      }
      const next = record?.nextCursor
      if (typeof next === 'string' && next !== '') cursor = next
      else break
    }
    return tools
  }

  async close(): Promise<void> {
    this.closed = true
    this.rejectAll(new Error('MCP session closed'))
    await terminateChild(this.child)
  }
}

function isDangerousToolName(name: string): boolean {
  return /(delete|remove|write|edit|create|exec|shell|command|kill|drop|upload|install|send|post|put|patch|navigate|click|type|fill|evaluate)/i.test(
    name,
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

function killChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // Fall through to a direct kill when the process group is gone.
    }
  }
  try {
    child.kill(signal)
  } catch {
    // Already gone.
  }
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
  killChild(child, 'SIGTERM')
  const stopped = await Promise.race([exited.then(() => true), delay(1000).then(() => false)])
  if (stopped) return
  killChild(child, 'SIGKILL')
  await Promise.race([exited, delay(500)])
}

function openSession(options: StdioProbeOptions, timeoutMs: number): StdioJsonRpcSession {
  if (options.command.trim() === '') throw new Error('缺少 MCP server command')
  return new StdioJsonRpcSession({
    command: options.command,
    args: options.args ?? [],
    env: buildChildEnv(options.env),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    timeoutMs,
  })
}

function probeErrorText(error: unknown, session: StdioJsonRpcSession | undefined): string {
  let text = stripAnsi(errorMessage(error))
  if (session !== undefined) {
    const stderr = session.stderrTail()
    if (stderr !== '' && !text.includes(stderr)) text += '\nstderr: ' + stderr
  }
  return text
}

function toolSummariesFromListResult(result: unknown): ToolSummary[] {
  const record = asRecord(result)
  const list = Array.isArray(record?.tools) ? record.tools : []
  const tools: ToolSummary[] = []
  for (const item of list) {
    const tool = asRecord(item)
    if (tool === undefined || typeof tool.name !== 'string') continue
    const summary: ToolSummary = { name: tool.name }
    if (typeof tool.description === 'string') summary.description = tool.description
    if (tool.inputSchema !== undefined) summary.inputSchema = tool.inputSchema
    if (isDangerousToolName(tool.name)) summary.dangerous = true
    tools.push(summary)
  }
  return tools
}

function serverInfoFromResult(result: unknown): { name?: string; version?: string } | undefined {
  const record = asRecord(result)
  const info = asRecord(record?.serverInfo)
  if (info === undefined) return undefined
  const serverInfo: { name?: string; version?: string } = {}
  if (typeof info.name === 'string') serverInfo.name = info.name
  if (typeof info.version === 'string') serverInfo.version = info.version
  return serverInfo
}

function extractToolText(result: unknown): string {
  const record = asRecord(result)
  const parts: string[] = []
  const content = record?.content
  if (Array.isArray(content)) {
    for (const item of content) {
      const block = asRecord(item)
      if (block === undefined) continue
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
        continue
      }
      if (block.type === 'image') {
        parts.push('[image]')
        continue
      }
      if (block.type === 'resource') {
        const resource = asRecord(block.resource)
        const uri = typeof resource?.uri === 'string' ? resource.uri : ''
        parts.push('[resource] ' + uri)
        continue
      }
      parts.push(JSON.stringify(block))
    }
  }
  if (record?.structuredContent !== undefined) parts.push(JSON.stringify(record.structuredContent))
  return parts.join('\n').slice(0, MAX_TOOL_TEXT)
}

/** Probe a stdio MCP server: initialize, then tools/list. */
export async function probeStdio(options: StdioProbeOptions): Promise<ProbeOutcome> {
  const started = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let session: StdioJsonRpcSession | undefined
  try {
    session = openSession(options, timeoutMs)
    await session.initialize()
    const tools = await session.listTools()
    const outcome: ProbeOutcome = { ok: true, tools, latencyMs: Date.now() - started }
    if (session.serverInfo !== undefined) outcome.serverInfo = session.serverInfo
    return outcome
  } catch (error) {
    return { ok: false, tools: [], latencyMs: Date.now() - started, error: probeErrorText(error, session) }
  } finally {
    if (session !== undefined) await session.close()
  }
}

/** Call one tool on a stdio MCP server (used by preset smoke tests). */
export async function callStdioTool(options: CallToolOptions): Promise<CallToolResult> {
  const started = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let session: StdioJsonRpcSession | undefined
  try {
    session = openSession(options, timeoutMs)
    await session.initialize()
    const result = await session.request('tools/call', {
      name: options.tool,
      arguments: options.toolArgs ?? {},
    })
    const text = extractToolText(result)
    const record = asRecord(result)
    if (record?.isError === true) {
      return {
        ok: false,
        text,
        latencyMs: Date.now() - started,
        error: text === '' ? 'MCP tool 返回 isError' : text,
      }
    }
    return { ok: true, text, latencyMs: Date.now() - started }
  } catch (error) {
    return { ok: false, text: '', latencyMs: Date.now() - started, error: probeErrorText(error, session) }
  } finally {
    if (session !== undefined) await session.close()
  }
}

interface HttpReply {
  status: number
  contentType: string
  text: string
  sessionId?: string
}

async function postJson(
  url: URL,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<HttpReply> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  const text = await response.text()
  const sessionId = response.headers.get('mcp-session-id')
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    text,
    ...(sessionId === null ? {} : { sessionId }),
  }
}

function parseRpcMessages(reply: HttpReply): unknown[] {
  const contentType = reply.contentType.toLowerCase()
  if (contentType.includes('text/event-stream')) {
    const messages: unknown[] = []
    for (const line of reply.text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '' || data === '[DONE]') continue
      try {
        messages.push(JSON.parse(data) as unknown)
      } catch {
        // Ignore non-JSON keepalives.
      }
    }
    if (messages.length === 0) throw new Error('MCP HTTP 事件流中没有 JSON-RPC 响应')
    return messages
  }
  if (reply.text.trim() === '') return []
  try {
    const parsed = JSON.parse(reply.text) as unknown
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    throw new Error('MCP HTTP 响应不是合法 JSON: ' + truncate(reply.text))
  }
}

function pickRpcResult(messages: unknown[], id: number): unknown {
  for (const message of messages) {
    const record = asRecord(message)
    if (record === undefined) continue
    if (record.id !== id) continue
    const rpcError = asRecord(record.error)
    if (rpcError !== undefined) {
      const detail = typeof rpcError.message === 'string' ? rpcError.message : JSON.stringify(rpcError)
      throw new Error('MCP 错误: ' + detail)
    }
    return record.result
  }
  for (const message of messages) {
    const record = asRecord(message)
    if (record !== undefined && record.result !== undefined) return record.result
  }
  return undefined
}

/** Probe a streamable HTTP MCP server (best effort: initialize + tools/list). */
export async function probeHttp(options: HttpProbeOptions): Promise<ProbeOutcome> {
  const started = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    let url: URL
    try {
      url = new URL(options.url)
    } catch {
      throw new Error('MCP URL 不合法: ' + options.url)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('MCP URL 只支持 http(s)')
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(options.headers ?? {}),
    }
    const initializeReply = await postJson(
      url,
      headers,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      },
      controller.signal,
    )
    if (initializeReply.status >= 400) {
      throw new Error('HTTP ' + String(initializeReply.status) + ': ' + truncate(initializeReply.text))
    }
    let sessionId = initializeReply.sessionId
    const initializeMessages = parseRpcMessages(initializeReply)
    const initializeResult = pickRpcResult(initializeMessages, 1)
    const sessionHeaders = (): Record<string, string> =>
      sessionId === undefined ? {} : { 'mcp-session-id': sessionId }
    try {
      const notifyReply = await postJson(
        url,
        { ...headers, ...sessionHeaders() },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        controller.signal,
      )
      if (notifyReply.sessionId !== undefined) sessionId = notifyReply.sessionId
    } catch {
      // Notifications are best effort.
    }
    const listReply = await postJson(
      url,
      { ...headers, ...sessionHeaders() },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      controller.signal,
    )
    if (listReply.sessionId !== undefined) sessionId = listReply.sessionId
    if (listReply.status >= 400) {
      throw new Error('HTTP ' + String(listReply.status) + ': ' + truncate(listReply.text))
    }
    const listMessages = parseRpcMessages(listReply)
    const tools = toolSummariesFromListResult(pickRpcResult(listMessages, 2))
    const outcome: ProbeOutcome = { ok: true, tools, latencyMs: Date.now() - started }
    const serverInfo = serverInfoFromResult(initializeResult)
    if (serverInfo !== undefined) outcome.serverInfo = serverInfo
    return outcome
  } catch (error) {
    const aborted = controller.signal.aborted
    const text = aborted
      ? 'MCP HTTP 连接超时（' + String(timeoutMs) + 'ms）'
      : stripAnsi(errorMessage(error))
    return { ok: false, tools: [], latencyMs: Date.now() - started, error: text }
  } finally {
    clearTimeout(timer)
  }
}
