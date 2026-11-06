/**
 * Managed-block editor for MCP rows in a profile's cordis.patch.yml.
 *
 * MCP Station owns exactly one block delimited by:
 *   # >>> dsh-mcp-station:begin
 *   # <<< dsh-mcp-station:end
 *
 * Everything outside the block is preserved byte-for-byte. Rows outside the
 * block are listed read-only (origin: 'external') and never modified.
 *
 * DSH patch semantics: a plain row in this file is an *override* addressed by
 * id, so a new MCP server only takes effect when it is listed under
 * "- insert:". The managed block therefore contains exactly one insert patch
 * whose members are the MCP Station rows.
 */

import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import type { ScalarTag, YAMLMap } from 'yaml'
import { findPresetForServer, loadCatalog } from './catalog.ts'
import type { CatalogFile, InstalledServer, McpTransport } from './shared/types.ts'

/** Plugin name of the DSH MCP client that owns each managed row. */
export const MCP_CLIENT_NAME = '@deepseek-ai/dsh-mcp-client'
/** Managed block start marker (stable: user files reference it). */
export const MANAGED_BLOCK_BEGIN = '# >>> dsh-mcp-station:begin'
/** Managed block end marker. */
export const MANAGED_BLOCK_END = '# <<< dsh-mcp-station:end'
/** Prefix of every row id owned by MCP Station. */
export const MANAGED_ID_PREFIX = 'mcp-station-'

/** One environment value: a plain string, env:NAME, or a raw !!js expression. */
export type EnvEntry = string | { js: string }
/** Environment / header map read from or written to a managed row. */
export type PatchEnv = Record<string, EnvEntry>

/** Row shape submitted to upsertManagedBlock. */
export interface ManagedRowInput {
  /** Loader entry id; defaults to mcp-station-<serverName>. */
  id?: string
  serverName: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  /** Extra environment. env:NAME is rendered as !!js process.env.NAME. */
  env?: PatchEnv
  /** Extra HTTP headers (streamable-http). env:NAME is rendered as !!js process.env.NAME. */
  headers?: PatchEnv
  /** Whether the row is active (false renders disabled: true). */
  enabled?: boolean
}

/** One MCP client row parsed from a patch document. */
export interface PatchRow {
  id?: string
  serverName: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  env?: PatchEnv
  headers?: PatchEnv
  enabled: boolean
  origin: 'station' | 'external'
}

/** Start/end offsets of the managed block inside a patch document. */
export interface ManagedBlockSpan {
  beginLineStart: number
  bodyStart: number
  bodyEnd: number
  endLineStart: number
  endLineEnd: number
}

/** Non-MCP content found inside the managed block; preserved verbatim. */
interface ForeignParts {
  header: string
  top: string[]
  members: string[]
}

/** Parsed view of the managed block. */
export interface ManagedBlockView {
  rows: PatchRow[]
  foreign: ForeignParts
}

/** Validation facts about one patch document. */
export interface PatchValidation {
  ok: boolean
  error?: string
  hasBlock: boolean
  rowCount?: number
}

/** Result of an atomic patch write. */
export interface WritePatchResult {
  created: boolean
  backupPath?: string
  backups: string[]
}

interface JsExpr {
  __jsExpr: string
}

/** !!js scalar tag: parse into a marker object. */
const jsExprTag: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value: string) => ({ __jsExpr: value }) as JsExpr,
  identify: (value: unknown): boolean => isJsExpr(value),
}

/** True when a parsed YAML value is a !!js expression marker. */
export function isJsExpr(value: unknown): value is JsExpr {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 1 && typeof record.__jsExpr === 'string'
}

const EMPTY_FOREIGN: ForeignParts = { header: '', top: [], members: [] }
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/
const ENV_REF_RE = /^env:([A-Za-z_][A-Za-z0-9_]*)$/
const PROCESS_ENV_RE = /^process\.env\.([A-Za-z_][A-Za-z0-9_]*)$/

/** Validate an MCP server namespace accepted by the MCP client. */
export function isValidServerName(value: string): boolean {
  return SERVER_NAME_RE.test(value)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

interface ScannedLine {
  start: number
  lineEnd: number
  content: string
}

function scanLines(text: string): ScannedLine[] {
  const lines: ScannedLine[] = []
  let start = 0
  for (;;) {
    const newline = text.indexOf('\n', start)
    const rawEnd = newline === -1 ? text.length : newline
    let content = text.slice(start, rawEnd)
    if (content.endsWith('\r')) content = content.slice(0, -1)
    lines.push({ start, lineEnd: newline === -1 ? text.length : newline + 1, content })
    if (newline === -1) break
    start = newline + 1
  }
  return lines
}

function lineStartOf(text: string, index: number): number {
  return text.lastIndexOf('\n', Math.max(0, index - 1)) + 1
}

function nodeStart(node: unknown): number {
  const range = (node as { range?: [number, number, number] }).range
  if (range === undefined) throw new Error('mcp-station: YAML 节点缺少位置信息')
  return range[0]
}

function findPair(map: YAMLMap, key: string): { key: unknown; value: unknown } | undefined {
  for (const pair of map.items) {
    if (isScalar(pair.key) && pair.key.value === key) {
      return pair as unknown as { key: unknown; value: unknown }
    }
  }
  return undefined
}

function parsePatchDocument(text: string) {
  const document = parseDocument(text, { logLevel: 'silent', customTags: [jsExprTag] })
  if (document.errors.length > 0) {
    throw new Error('cordis.patch.yml 解析失败: ' + String(document.errors[0]?.message ?? document.errors[0]))
  }
  return document
}

/** Locate the managed block; undefined when the file has no markers. Throws on a half block. */
export function locateManagedBlock(text: string): ManagedBlockSpan | undefined {
  const lines = scanLines(text)
  const begins = lines.filter((line) => line.content.trim() === MANAGED_BLOCK_BEGIN)
  const ends = lines.filter((line) => line.content.trim() === MANAGED_BLOCK_END)
  if (begins.length === 0 && ends.length === 0) return undefined
  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error('cordis.patch.yml 中 MCP Station 受管块标记不完整（begin/end 必须各出现一次）')
  }
  const begin = begins[0]!
  const end = ends[0]!
  if (end.start < begin.start) {
    throw new Error('cordis.patch.yml 中 MCP Station 受管块标记顺序错误（end 在 begin 之前）')
  }
  return {
    beginLineStart: begin.start,
    bodyStart: begin.lineEnd,
    bodyEnd: end.start,
    endLineStart: end.start,
    endLineEnd: end.lineEnd,
  }
}

function quoteYamlScalar(value: string): string {
  if (value === '') return "''"
  if (/[\n\r\u0000-\u001f]/.test(value)) return JSON.stringify(value)
  if (
    /^[A-Za-z_][A-Za-z0-9_./:@+=,?#%&~-]*$/.test(value) &&
    !/^(true|false|null|yes|no|on|off)$/i.test(value) &&
    !value.endsWith(':')
  ) {
    return value
  }
  return "'" + value.replace(/'/g, "''") + "'"
}

function renderEnvValue(value: EnvEntry): string {
  if (typeof value !== 'string') return renderJsExpression(value.js)
  const ref = ENV_REF_RE.exec(value)
  if (ref !== null) return '!!js process.env.' + ref[1]
  return quoteYamlScalar(value)
}

function renderJsExpression(expression: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(expression)) return '!!js ' + expression
  if (!/[\n\r\u0000-\u001f]/.test(expression)) {
    return "!!js '" + expression.replace(/'/g, "''") + "'"
  }
  return '!!js ' + JSON.stringify(expression)
}

function renderStringMapBlock(
  lines: string[],
  field: 'env' | 'headers',
  map: PatchEnv | undefined,
  indent: string,
): void {
  if (map === undefined) return
  const keys = Object.keys(map)
  if (keys.length === 0) return
  lines.push(indent + field + ':')
  for (const key of keys) {
    const renderedKey = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : quoteYamlScalar(key)
    lines.push(indent + '  ' + renderedKey + ': ' + renderEnvValue(map[key]!))
  }
}

/** Render one managed row as YAML lines (without the block markers). */
export function renderManagedRow(row: ManagedRowInput): string[] {
  const serverName = row.serverName
  if (!isValidServerName(serverName)) throw new Error('serverName 不合法: ' + serverName)
  const id = row.id ?? MANAGED_ID_PREFIX + serverName
  const lines = [
    '- id: ' + id,
    "  name: '" + MCP_CLIENT_NAME + "'",
    '  config:',
    '    serverName: ' + serverName,
    '    transport: ' + row.transport,
  ]
  if (row.transport === 'streamable-http') {
    if (row.url !== undefined) lines.push('    url: ' + quoteYamlScalar(row.url))
  } else {
    if (row.command !== undefined) lines.push('    command: ' + quoteYamlScalar(row.command))
    if (row.args !== undefined && row.args.length > 0) {
      lines.push('    args: [' + row.args.map((arg) => quoteYamlScalar(arg)).join(', ') + ']')
    }
  }
  renderStringMapBlock(lines, 'env', row.env, '    ')
  renderStringMapBlock(lines, 'headers', row.headers, '    ')
  if (row.enabled === false) lines.push('  disabled: true')
  return lines
}

function normalizeRows(rows: readonly ManagedRowInput[]): ManagedRowInput[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const serverName = row.serverName
    if (!isValidServerName(serverName)) throw new Error('serverName 不合法: ' + serverName)
    const key = serverName.toLowerCase()
    if (seen.has(key)) throw new Error('serverName 重复: ' + serverName)
    seen.add(key)
    if (row.transport === 'stdio' && (row.command === undefined || row.command === '')) {
      throw new Error('stdio 行缺少 command: ' + serverName)
    }
    if (row.transport === 'streamable-http' && (row.url === undefined || row.url === '')) {
      throw new Error('streamable-http 行缺少 url: ' + serverName)
    }
    return {
      ...row,
      id: row.id ?? MANAGED_ID_PREFIX + serverName,
      enabled: row.enabled !== false,
      ...(row.args === undefined ? {} : { args: [...row.args] }),
      ...(row.env === undefined ? {} : { env: { ...row.env } }),
      ...(row.headers === undefined ? {} : { headers: { ...row.headers } }),
    }
  })
}

function pushRawLines(lines: string[], raw: string): void {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const parts = normalized.split('\n')
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  lines.push(...parts)
}

function renderManagedBlockText(rows: readonly ManagedRowInput[], foreign: ForeignParts, eol: string): string {
  const lines: string[] = []
  if (foreign.header.trim() !== '') pushRawLines(lines, foreign.header)
  for (const raw of foreign.top) if (raw.trim() !== '') pushRawLines(lines, raw)
  const hasMembers = foreign.members.some((item) => item.trim() !== '')
  if (rows.length > 0 || hasMembers) {
    lines.push('- insert:')
    for (const raw of foreign.members) if (raw.trim() !== '') pushRawLines(lines, raw)
    for (const row of rows) {
      for (const line of renderManagedRow(row)) lines.push('    ' + line)
    }
  }
  if (lines.length === 0) return ''
  return [MANAGED_BLOCK_BEGIN, ...lines, MANAGED_BLOCK_END].join(eol) + eol
}

function isKnownStationRow(value: unknown): boolean {
  const row = asRecord(value)
  if (row === undefined) return false
  if (typeof row.id !== 'string' || !row.id.startsWith(MANAGED_ID_PREFIX)) return false
  if (row.name !== MCP_CLIENT_NAME) return false
  if (row.disabled !== undefined && typeof row.disabled !== 'boolean') return false
  for (const key of Object.keys(row)) {
    if (key !== 'id' && key !== 'name' && key !== 'config' && key !== 'disabled') return false
  }
  const config = asRecord(row.config)
  if (config === undefined) return false
  for (const key of Object.keys(config)) {
    if (
      key !== 'serverName' &&
      key !== 'transport' &&
      key !== 'command' &&
      key !== 'args' &&
      key !== 'env' &&
      key !== 'url' &&
      key !== 'headers'
    ) {
      return false
    }
  }
  return typeof config.serverName === 'string' && isValidServerName(config.serverName)
}

function isMcpRow(value: unknown): boolean {
  const row = asRecord(value)
  if (row === undefined) return false
  if (row.name !== MCP_CLIENT_NAME) return false
  const config = asRecord(row.config)
  return config !== undefined && typeof config.serverName === 'string'
}

function parseEnvMap(value: unknown): PatchEnv | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const env: PatchEnv = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string') {
      env[key] = item
      continue
    }
    if (isJsExpr(item)) {
      const ref = PROCESS_ENV_RE.exec(item.__jsExpr.trim())
      env[key] = ref === null ? { js: item.__jsExpr } : 'env:' + ref[1]
      continue
    }
    if (item !== null && item !== undefined) env[key] = String(item)
  }
  return env
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

function parseManagedRow(value: unknown, origin: 'station' | 'external'): PatchRow | undefined {
  const row = asRecord(value)
  if (row === undefined) return undefined
  const config = asRecord(row.config)
  if (config === undefined) return undefined
  const serverName =
    typeof config.serverName === 'string' ? config.serverName : typeof row.id === 'string' ? row.id : undefined
  if (serverName === undefined) return undefined
  const transport: McpTransport = config.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  const parsed: PatchRow = {
    serverName,
    transport,
    enabled: row.disabled !== true,
    origin,
  }
  if (typeof row.id === 'string') parsed.id = row.id
  if (typeof config.command === 'string') parsed.command = config.command
  const args = stringArray(config.args)
  if (args !== undefined) parsed.args = args
  if (typeof config.url === 'string') parsed.url = config.url
  const env = parseEnvMap(config.env)
  if (env !== undefined) parsed.env = env
  const headers = parseEnvMap(config.headers)
  if (headers !== undefined) parsed.headers = headers
  return parsed
}

/**
 * Read station rows and verbatim foreign parts from the managed block.
 * Throws when markers are malformed or the block is not a YAML sequence.
 */
export function readManagedBlock(text: string): ManagedBlockView {
  const span = locateManagedBlock(text)
  if (span === undefined) return { rows: [], foreign: { header: '', top: [], members: [] } }
  const body = text.slice(span.bodyStart, span.bodyEnd)
  if (body.trim() === '') return { rows: [], foreign: { header: '', top: [], members: [] } }
  const document = parsePatchDocument(body)
  const foreign: ForeignParts = { header: '', top: [], members: [] }
  if (document.contents === null) {
    foreign.header = body
    return { rows: [], foreign }
  }
  const contents = document.contents
  if (!isSeq(contents)) throw new Error('MCP Station 受管块内容必须是 YAML 数组')
  const nodes = contents.items
  const values = document.toJS() as unknown[]
  if (nodes.length > 0) foreign.header = body.slice(0, lineStartOf(body, nodeStart(nodes[0])))
  const rows: PatchRow[] = []
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const value = values[index]
    const start = lineStartOf(body, nodeStart(node))
    const end = index + 1 < nodes.length ? lineStartOf(body, nodeStart(nodes[index + 1]!)) : body.length
    const raw = body.slice(start, end)
    const insertPair = isMap(node) ? findPair(node, 'insert') : undefined
    const keys = isMap(node) ? node.items.map((pair) => (isScalar(pair.key) ? String(pair.key.value) : '')) : []
    const insertOnly = insertPair !== undefined && keys.length === 1 && keys[0] === 'insert'
    if (insertOnly) {
      const pairValue = insertPair.value
      if (!isSeq(pairValue)) {
        foreign.top.push(raw)
        continue
      }
      const members = pairValue.items
      const insertValue = asRecord(value)?.insert
      const memberValues = Array.isArray(insertValue) ? insertValue : []
      for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
        const member = members[memberIndex]!
        const memberStart = lineStartOf(body, nodeStart(member))
        const memberEnd =
          memberIndex + 1 < members.length ? lineStartOf(body, nodeStart(members[memberIndex + 1]!)) : end
        const memberRaw = body.slice(memberStart, memberEnd)
        const memberValue = memberValues[memberIndex]
        if (isKnownStationRow(memberValue)) {
          const row = parseManagedRow(memberValue, 'station')
          if (row !== undefined) rows.push(row)
        } else {
          foreign.members.push(memberRaw)
        }
      }
      continue
    }
    if (isKnownStationRow(value)) {
      const row = parseManagedRow(value, 'station')
      if (row !== undefined) rows.push(row)
      continue
    }
    foreign.top.push(raw)
  }
  return { rows, foreign }
}

/**
 * List every MCP client row in a patch document.
 * Rows inside the managed block are station; rows outside are external.
 */
export function parsePatchRows(text: string): PatchRow[] {
  if (text.trim() === '') return []
  const document = parsePatchDocument(text)
  if (document.contents === null) return []
  const contents = document.contents
  if (!isSeq(contents)) throw new Error('cordis.patch.yml 必须是顶层 YAML 数组')
  const span = locateManagedBlock(text)
  const nodes = contents.items
  const values = document.toJS() as unknown[]
  const rows: PatchRow[] = []
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const value = values[index]
    const inside = span !== undefined && nodeStart(node) >= span.bodyStart && nodeStart(node) < span.bodyEnd
    const insertPair = isMap(node) ? findPair(node, 'insert') : undefined
    const keys = isMap(node) ? node.items.map((pair) => (isScalar(pair.key) ? String(pair.key.value) : '')) : []
    const insertOnly = insertPair !== undefined && keys.length === 1 && keys[0] === 'insert'
    if (insertOnly && isSeq(insertPair.value)) {
      const insert = asRecord(value)?.insert
      const members = Array.isArray(insert) ? insert : []
      for (const member of members) {
        if (!isMcpRow(member)) continue
        const origin = inside && isKnownStationRow(member) ? 'station' : 'external'
        const row = parseManagedRow(member, origin)
        if (row !== undefined) rows.push(row)
      }
      continue
    }
    if (isMcpRow(value)) {
      const origin = inside && isKnownStationRow(value) ? 'station' : 'external'
      const row = parseManagedRow(value, origin)
      if (row !== undefined) rows.push(row)
    }
  }
  return rows
}

function ensureTopLevelArray(text: string): string {
  const document = parseDocument(text, { logLevel: 'silent', customTags: [jsExprTag] })
  if (document.errors.length > 0) return text
  if (isSeq(document.contents)) return text
  if (document.contents === null) {
    const trimmed = text.replace(/\s+$/, '')
    return (trimmed === '' ? '' : trimmed + '\n') + '[]\n'
  }
  return text
}

function appendManagedBlock(text: string, block: string, eol: string): string {
  if (text.trim() === '') return block
  const meaningful = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
  if (meaningful.length === 1 && meaningful[0] === '[]') {
    const index = text.lastIndexOf('[]')
    if (index >= 0) return text.slice(0, index) + block + text.slice(index + 2)
  }
  return text + (text.endsWith('\n') ? '' : eol) + block
}

/**
 * Insert or replace the managed block, returning the next document text.
 * Bytes outside the block are copied verbatim.
 */
export function upsertManagedBlock(text: string, rows: readonly ManagedRowInput[]): string {
  const eol = detectEol(text)
  const normalized = normalizeRows(rows)
  const span = locateManagedBlock(text)
  let next: string
  if (span !== undefined) {
    const existing = readManagedBlock(text)
    const block = renderManagedBlockText(normalized, existing.foreign, eol)
    next = text.slice(0, span.beginLineStart) + block + text.slice(span.endLineEnd)
    if (block === '') next = ensureTopLevelArray(next)
  } else {
    if (normalized.length === 0) return text
    const block = renderManagedBlockText(normalized, EMPTY_FOREIGN, eol)
    next = appendManagedBlock(text, block, eol)
  }
  assertPatchText(next)
  return next
}

/** Append one managed row after the existing station rows. */
export function addManagedRow(text: string, row: ManagedRowInput): string {
  const all = text.trim() === '' ? [] : parsePatchRows(text)
  if (all.some((existing) => existing.serverName.toLowerCase() === row.serverName.toLowerCase())) {
    throw new Error('serverName 已存在: ' + row.serverName)
  }
  const managed = locateManagedBlock(text) === undefined ? [] : readManagedBlock(text).rows
  return upsertManagedBlock(text, [...managed, row])
}

/** Replace one station row in place (same serverName; keeps the existing id). */
export function replaceManagedRow(text: string, row: ManagedRowInput): string {
  const managed = readManagedBlock(text).rows
  const index = managed.findIndex((existing) => existing.serverName === row.serverName)
  if (index < 0) throw new Error('受管块中找不到 MCP server: ' + row.serverName)
  const next = managed.map((existing, rowIndex) => {
    if (rowIndex !== index) return existing
    return {
      ...row,
      id: row.id ?? existing.id,
      enabled: row.enabled ?? existing.enabled,
    }
  })
  return upsertManagedBlock(text, next)
}

/** Enable or disable one station row. Throws when the row is not in the managed block. */
export function setManagedRowEnabled(text: string, serverName: string, enabled: boolean): string {
  const managed = readManagedBlock(text).rows
  const index = managed.findIndex((row) => row.serverName === serverName)
  if (index < 0) throw new Error('受管块中找不到 MCP server: ' + serverName)
  const next = managed.map((row, rowIndex) => ({ ...row, enabled: rowIndex === index ? enabled : row.enabled }))
  return upsertManagedBlock(text, next)
}

/** Remove one station row. Throws when the row is not in the managed block. */
export function removeManagedRow(text: string, serverName: string): string {
  const managed = readManagedBlock(text).rows
  const next = managed.filter((row) => row.serverName !== serverName)
  if (next.length === managed.length) throw new Error('受管块中找不到 MCP server: ' + serverName)
  return upsertManagedBlock(text, next)
}

/** Validate one patch document, optionally requiring the managed block. */
export function inspectPatchText(text: string, options: { requireBlock?: boolean } = {}): PatchValidation {
  let span: ManagedBlockSpan | undefined
  try {
    span = locateManagedBlock(text)
  } catch (error) {
    return { ok: false, error: errorMessage(error), hasBlock: false }
  }
  const hasBlock = span !== undefined
  if (text.trim() === '') return { ok: false, error: 'cordis.patch.yml 为空', hasBlock }
  let document: ReturnType<typeof parseDocument>
  try {
    document = parseDocument(text, { logLevel: 'silent', customTags: [jsExprTag] })
  } catch (error) {
    return { ok: false, error: errorMessage(error), hasBlock }
  }
  if (document.errors.length > 0) {
    return { ok: false, error: String(document.errors[0]?.message ?? document.errors[0]), hasBlock }
  }
  if (!isSeq(document.contents)) {
    return { ok: false, error: 'cordis.patch.yml 顶层必须是 YAML 数组', hasBlock }
  }
  if (options.requireBlock === true && !hasBlock) {
    return { ok: false, error: 'MCP Station 受管块不存在', hasBlock }
  }
  return { ok: true, hasBlock }
}

/** Throw when a patch document is not safe to write. */
export function assertPatchText(text: string, options: { requireBlock?: boolean } = {}): void {
  const result = inspectPatchText(text, options)
  if (!result.ok) throw new Error('cordis.patch.yml 校验失败: ' + (result.error ?? 'unknown'))
}

/** Read a patch file. A missing file yields { text: '', exists: false }. */
export async function readPatchText(patchPath: string): Promise<{ text: string; exists: boolean }> {
  try {
    return { text: await readFile(patchPath, 'utf8'), exists: true }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { text: '', exists: false }
    throw new Error('无法读取 cordis.patch.yml（' + patchPath + '）: ' + errorMessage(error))
  }
}

/** Read one patch file. A missing file reads as ''. */
export async function readPatchFile(patchPath: string): Promise<string> {
  return (await readPatchText(patchPath)).text
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

async function renameIfExists(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/**
 * Atomically write a patch document.
 *
 * Order: validate the next text, write a sibling temp file, validate the temp
 * file, rotate .bak / .bak.1 / .bak.2 (latest three), then rename the temp
 * over the target. A failure never leaves a half-written target file.
 */
export async function writePatchTextAtomic(
  patchPath: string,
  nextText: string,
  options: { requireBlock?: boolean } = {},
): Promise<WritePatchResult> {
  assertPatchText(nextText, options)
  const dir = dirname(patchPath)
  await mkdir(dir, { recursive: true })
  const tempPath = join(dir, '.' + basename(patchPath) + '.tmp-' + process.pid + '-' + randomSuffix())
  let targetExists = false
  let mode = 0o600
  try {
    const info = await stat(patchPath)
    targetExists = info.isFile()
    mode = info.mode & 0o777
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    await writeFile(tempPath, nextText, { encoding: 'utf8', mode })
    const tempText = await readFile(tempPath, 'utf8')
    assertPatchText(tempText, options)
    let backupPath: string | undefined
    if (targetExists) {
      const backup = patchPath + '.bak'
      await rm(backup + '.2', { force: true })
      await renameIfExists(backup + '.1', backup + '.2')
      await renameIfExists(backup, backup + '.1')
      await copyFile(patchPath, backup)
      backupPath = backup
    }
    try {
      await rename(tempPath, patchPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (targetExists && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) {
        await rm(patchPath, { force: true })
        await rename(tempPath, patchPath)
      } else {
        throw error
      }
    }
    return {
      created: !targetExists,
      ...(backupPath === undefined ? {} : { backupPath }),
      backups: backupPath === undefined ? [] : [backupPath],
    }
  } finally {
    await rm(tempPath, { force: true }).catch(() => {})
  }
}

/** Convert one parsed row into the API-facing installed-server shape. */
export function installedFromServer(row: PatchRow, catalog?: CatalogFile): InstalledServer {
  const preset = catalog === undefined ? undefined : findPresetForServer(catalog, row.serverName)
  const server: InstalledServer = {
    serverName: row.serverName,
    transport: row.transport,
    enabled: row.enabled,
    origin: row.origin,
    status: row.enabled ? 'unknown' : 'disabled',
  }
  if (preset !== undefined) {
    server.presetId = preset.id
    server.displayName = preset.displayName
  }
  if (row.command !== undefined) server.command = row.command
  if (row.args !== undefined) server.args = row.args
  if (row.url !== undefined) server.url = row.url
  // Only station rows are editable, so only they need their local env/headers
  // round-tripped to the UI; external rows stay read-only and never echo values.
  if (row.origin === 'station') {
    const env = flattenConfigMap(row.env)
    if (env !== undefined) server.env = env
    const headers = flattenConfigMap(row.headers)
    if (headers !== undefined) server.headers = headers
  }
  return server
}

/** Flatten env/headers for the API; complex !!js expressions keep a visible prefix. */
function flattenConfigMap(map: PatchEnv | undefined): Record<string, string> | undefined {
  if (map === undefined) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(map)) {
    out[key] = typeof value === 'string' ? value : '!!js ' + value.js
  }
  return out
}

/** Read installed servers from the profile patch and the station block. */
export async function listInstalledServers(patchPath: string): Promise<InstalledServer[]> {
  const { text, exists } = await readPatchText(patchPath)
  if (!exists || text.trim() === '') return []
  const rows = parsePatchRows(text)
  const catalog = await loadCatalog().catch(() => undefined)
  return rows.map((row) => installedFromServer(row, catalog))
}
