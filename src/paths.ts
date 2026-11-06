/**
 * Resolve DSH Home, the active profile, and the profile's cordis.patch.yml.
 *
 * The active profile is inferred without extra host APIs:
 * 1. explicit config.profile;
 * 2. DSH_PROFILE env;
 * 3. process.cwd() when it is <dshHome>/profiles/<name>;
 * 4. the unique profile that depends on dsh-mcp-station;
 * 5. the desktop profile, then the first existing profile.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'

export interface StationPaths {
  dshHome: string
  profile: string
  profileDir: string
  patchPath: string
  workspace: string
}

/** Expand a leading ~ and resolve the rest against the process cwd. */
export function expandHome(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~' + sep)) return join(homedir(), value.slice(2))
  return resolve(value)
}

/** $DSH_HOME or ~/.dsh. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env, override?: string): string {
  const direct = typeof override === 'string' ? override.trim() : ''
  if (direct !== '') return expandHome(direct)
  const fromEnv = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return expandHome(fromEnv === '' ? join(homedir(), '.dsh') : fromEnv)
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

/** Existing profile names (directories containing package.json), sorted. */
export function profileNames(dshHome: string): string[] {
  const root = join(dshHome, 'profiles')
  let entries: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const names: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const dir = join(root, entry.name)
    if (existsSync(join(dir, 'package.json'))) names.push(entry.name)
  }
  return names.sort()
}

function dependsOnStation(profileDir: string, packageName: string): boolean {
  const manifest = readJson<{
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: unknown } }
  }>(join(profileDir, 'package.json'))
  if (manifest === undefined) return false
  const declared = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) }
  if (typeof declared[packageName] === 'string') return true
  const bundles = manifest.dsh?.profile?.bundles
  return Array.isArray(bundles) && bundles.includes(packageName)
}

/** Infer the profile this plugin is mounted in. Throws when DSH Home has no profile. */
export function inferProfile(dshHome: string, configured?: string, packageName = 'dsh-mcp-station'): string {
  const names = profileNames(dshHome)
  if (names.length === 0) throw new Error('No DSH profile under ' + join(dshHome, 'profiles'))

  const explicit = configured?.trim() || process.env.DSH_PROFILE?.trim() || ''
  if (explicit !== '' && names.includes(explicit)) return explicit

  const cwd = process.cwd()
  const rel = relative(join(dshHome, 'profiles'), cwd)
  if (rel !== '' && !rel.startsWith('..') && !rel.includes(sep)) {
    const name = basename(cwd)
    if (names.includes(name)) return name
  }

  const matching = names.filter((name) => dependsOnStation(join(dshHome, 'profiles', name), packageName))
  if (matching.length === 1) return matching[0]
  if (names.includes('desktop')) return 'desktop'
  return names[0]
}

/** Best-effort workspace directory: config override, DSH_WORKSPACE, <dshHome>/workspace, cwd. */
export function resolveWorkspace(dshHome: string, configured?: string): string {
  const direct = configured?.trim() || process.env.DSH_WORKSPACE?.trim() || ''
  if (direct !== '') return expandHome(direct)
  const candidate = join(dshHome, 'workspace')
  if (existsSync(candidate)) return candidate
  return process.cwd()
}

/** Resolve every path the host API needs. */
export function resolveStationPaths(options: { dshHome?: string; profile?: string; workspace?: string } = {}): StationPaths {
  const dshHome = resolveDshHome(process.env, options.dshHome)
  const profile = inferProfile(dshHome, options.profile)
  const profileDir = join(dshHome, 'profiles', profile)
  return {
    dshHome,
    profile,
    profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    workspace: resolveWorkspace(dshHome, options.workspace),
  }
}
