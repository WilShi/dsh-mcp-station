/** Small field parsers shared by the custom-server and market-source dialogs. */

/** Result of parsing KEY=VALUE text. */
export interface PairParse {
  map: Record<string, string>
  /** 1-based line number of the first malformed line, 0 when valid. */
  errorLine: number
  /** Raw values that still look like a disk-only `!!js` expression. */
  jsValues: string[]
}

/**
 * Convert a stored value back into its editable form.
 * @param value - value as returned by the host.
 * @returns the `env:NAME` form for process.env references, otherwise the value.
 */
export function toEditableValue(value: string): string {
  const match = /^!!js\s+process\.env\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(value)
  return match === null ? value : 'env:' + (match[1] ?? '')
}

/**
 * Render a config map as KEY=VALUE lines.
 * @param map - optional config map.
 * @returns one line per entry.
 */
export function formatPairs(map: Record<string, string> | undefined): string {
  if (map === undefined) return ''
  return Object.entries(map)
    .map(([key, value]) => key + '=' + toEditableValue(value))
    .join('\n')
}

/**
 * Parse KEY=VALUE lines, ignoring blanks and comments.
 * @param text - textarea content.
 * @returns the map plus the first malformed line number and any `!!js` values.
 */
export function parsePairs(text: string): PairParse {
  const map: Record<string, string> = {}
  const jsValues: string[] = []
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim()
    if (line === '' || line.startsWith('#')) continue
    const equals = line.indexOf('=')
    if (equals <= 0) return { map: {}, errorLine: index + 1, jsValues: [] }
    const key = line.slice(0, equals).trim()
    if (key === '') return { map: {}, errorLine: index + 1, jsValues: [] }
    let value = line.slice(equals + 1).trim()
    if (value.length >= 2) {
      const first = value.charAt(0)
      const last = value.charAt(value.length - 1)
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1)
    }
    if (value.startsWith('!!js ')) jsValues.push(value)
    map[key] = value
  }
  return { map, errorLine: 0, jsValues }
}

/**
 * Parse argument text: one argument per line, or a single space-separated line.
 * @param text - textarea content.
 * @returns the argument list.
 */
export function parseArgs(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
  if (lines.length === 1) {
    return (lines[0] ?? '').split(/\s+/).filter(token => token !== '')
  }
  return lines
}

/**
 * Whether a value is a usable HTTP(S) URL.
 * @param value - candidate URL.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
