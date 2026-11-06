/** Host environment detection: Chrome, Playwright browser cache, workspace. */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface ChromeInfo {
  available: boolean
  path?: string
  version?: string
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

/** Detect a local Chrome/Chromium-family browser. */
export function detectChrome(): ChromeInfo {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) continue
      let version: string | undefined
      try {
        version = execFileSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim()
      } catch {
        version = undefined
      }
      return { available: true, path: candidate, ...(version === undefined ? {} : { version }) }
    } catch {
      // keep looking
    }
  }
  return { available: false }
}

/** Cached Playwright browser revisions, newest first. */
export function playwrightBrowserCache(): string[] {
  const dir = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith('chromium') || name.startsWith('chrome-'))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

/** Expand ~ and {{...}} placeholders used by catalog templates. */
export function expandTemplate(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const found = vars[key]
    if (found === undefined) return match
    if (found === '~') return homedir()
    if (found.startsWith('~/')) return join(homedir(), found.slice(2))
    return found
  })
}


/** Best-effort DSH host version detection. */
export function detectDshVersion(): string {
  const fromEnv = typeof process.env.DSH_VERSION === 'string' ? process.env.DSH_VERSION.trim() : ''
  if (fromEnv !== '') return fromEnv
  try {
    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve('@deepseek-ai/dsh/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    if (typeof pkg.version === 'string' && pkg.version !== '') return pkg.version
  } catch {
    // fall through to argv probing
  }
  try {
    const argv = process.argv[1]
    if (argv !== undefined) {
      const marker = '@deepseek-ai/dsh/lib/bin.js'
      const normalized = argv.replace(/\\/g, '/')
      const index = normalized.indexOf(marker)
      if (index >= 0) {
        const prefix = argv.slice(0, index)
        const pkgPath = resolve(prefix, '@deepseek-ai/dsh/package.json')
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
        if (typeof pkg.version === 'string' && pkg.version !== '') return pkg.version
      }
    }
  } catch {
    // ignore
  }
  return 'unknown'
}
