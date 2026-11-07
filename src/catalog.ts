/** Bundled preset catalog loader and install-time template resolver. */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ManagedRowInput, PatchEnv } from './patch.ts'
import type { CatalogFile, CatalogPreset } from './shared/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const CATALOG_PATH = join(here, '..', 'data', 'catalog.json')
const ENV_REF_RE = /^env:[A-Za-z_][A-Za-z0-9_]*$/

/** Read and validate the bundled catalog. */
export async function loadCatalog(): Promise<CatalogFile> {
  const raw = await readFile(CATALOG_PATH, 'utf8')
  const parsed = JSON.parse(raw) as CatalogFile
  if (typeof parsed.version !== 'number' || !Array.isArray(parsed.presets)) {
    throw new Error('mcp-station: invalid bundled catalog')
  }
  return parsed
}

/** Find a preset by id. */
export function findPreset(catalog: CatalogFile, id: string): CatalogPreset | undefined {
  return catalog.presets.find((preset) => preset.id === id)
}

/** Find the preset that produced a server name (including numeric suffixes). */
export function findPresetForServer(catalog: CatalogFile, serverName: string): CatalogPreset | undefined {
  const exact = catalog.presets.find((preset) => preset.serverName === serverName)
  if (exact !== undefined) return exact
  const suffixed = /^(.*)-(\d+)$/.exec(serverName)
  if (suffixed === null) return undefined
  const base = suffixed[1]!
  return catalog.presets.find((preset) => preset.serverName === base)
}

/** Choose a free serverName for a preset, appending a numeric suffix when needed. */
export function uniqueServerName(base: string, taken: readonly string[]): string {
  const names = new Set(taken.map((name) => name.toLowerCase()))
  if (!names.has(base.toLowerCase())) return base
  for (let index = 2; index < 100; index += 1) {
    const candidate = base + '-' + String(index)
    if (!names.has(candidate.toLowerCase())) return candidate
  }
  throw new Error('mcp-station: could not allocate a unique server name')
}

/** Values available while resolving a preset template. */
export interface TemplateVars {
  workspace: string
  dshHome: string
  profile?: string
  [key: string]: string | undefined
}

function templatePattern(): RegExp {
  return /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g
}

/** Replace {{key}} placeholders; unknown keys are left untouched for validation. */
export function resolveTemplate(value: string, vars: Record<string, string | undefined>): string {
  return value.replace(templatePattern(), (match, key: string) => {
    const found = vars[key]
    return found === undefined ? match : found
  })
}

/** Placeholder keys still present in a rendered value. */
export function unresolvedTemplateKeys(value: string): string[] {
  const keys: string[] = []
  for (const match of value.matchAll(templatePattern())) {
    if (match[1] !== undefined) keys.push(match[1])
  }
  return keys
}

/** Resolve the install dialog values, applying defaults and validating input kinds. */
export function resolvePresetValues(
  preset: CatalogPreset,
  provided: Record<string, string> | undefined,
  vars: TemplateVars,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const input of preset.inputs ?? []) {
    const rawProvided = provided?.[input.key]
    const raw = typeof rawProvided === 'string' && rawProvided.trim() !== '' ? rawProvided : input.default ?? ''
    const resolved = resolveTemplate(raw, { ...vars, ...values }).trim()
    if (resolved === '') {
      if (input.required === true) throw new Error('缺少必填输入: ' + input.key)
      values[input.key] = ''
      continue
    }
    if (input.kind === 'url') {
      let parsed: URL
      try {
        parsed = new URL(resolved)
      } catch {
        throw new Error('输入不是合法 URL: ' + input.key)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('输入只支持 http(s) URL: ' + input.key)
      }
    }
    values[input.key] = resolved
  }
  return values
}

function mustResolve(label: string, value: string, scope: Record<string, string | undefined>): string {
  const resolved = resolveTemplate(value, scope)
  const missing = unresolvedTemplateKeys(resolved)
  if (missing.length > 0) {
    throw new Error(label + ' 存在未解析的模板变量: ' + missing.join(', '))
  }
  return resolved
}

/**
 * Render one preset into a managed row.
 * - {{inputKey}} / {{workspace}} / {{dshHome}} / {{profile}} are resolved;
 * - env value "env:NAME" is preserved so the patch renders !!js process.env.NAME;
 * - any other env value is resolved as a normal template.
 */
export function resolvePresetRow(
  preset: CatalogPreset,
  provided: Record<string, string> | undefined,
  vars: TemplateVars,
): ManagedRowInput {
  const values = resolvePresetValues(preset, provided, vars)
  const scope: Record<string, string | undefined> = { ...vars, ...values }
  const row: ManagedRowInput = {
    serverName: preset.serverName,
    transport: preset.transport,
    enabled: true,
  }
  if (preset.transport === 'stdio') {
    if (preset.command === undefined || preset.command === '') throw new Error('预设缺少 command: ' + preset.id)
    row.command = mustResolve('command', preset.command, scope)
    const args = (preset.args ?? []).map((arg, index) => mustResolve('args[' + String(index) + ']', arg, scope))
    if (args.length > 0) row.args = args
  } else {
    if (preset.url === undefined || preset.url === '') throw new Error('预设缺少 url: ' + preset.id)
    const url = mustResolve('url', preset.url, scope)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('预设 URL 无法解析: ' + preset.id)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('预设 URL 只支持 http(s): ' + preset.id)
    }
    row.url = url
  }
  if (preset.env !== undefined) {
    const env: PatchEnv = {}
    for (const [key, value] of Object.entries(preset.env)) {
      if (ENV_REF_RE.test(value)) {
        env[key] = value
        continue
      }
      env[key] = mustResolve('env.' + key, value, scope)
    }
    if (Object.keys(env).length > 0) row.env = env
  }
  if (preset.headers !== undefined) {
    const headers: PatchEnv = {}
    for (const [key, value] of Object.entries(preset.headers)) {
      if (ENV_REF_RE.test(value)) {
        headers[key] = value
        continue
      }
      headers[key] = mustResolve('headers.' + key, value, scope)
    }
    if (Object.keys(headers).length > 0) row.headers = headers
  }
  return row
}
