/**
 * Client bundle build: esbuild-bundles src/client/entry.tsx to browser CJS with
 * every module the DSH web shell provides kept external, then wraps the result
 * in the `window.__ModuleLoader__.load({ id, factory })` form the shell loader
 * expects. Output: lib/client.js.
 */

import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'src/client/entry.tsx')
const outDir = join(root, 'lib')
const tmpDir = join(outDir, '.tmp')
const tmpFile = join(tmpDir, 'client.cjs')
const outFile = join(outDir, 'client.js')

/** Stable Loader id of the client plugin row (the package name). */
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const PLUGIN_ID = pkg.name

/**
 * Modules resolved from the DSH web shell module table at runtime. Every
 * module the bundle is allowed to `require()` must be listed here;
 * verify-client.mjs fails the build when another package import slips in.
 */
export const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  'react-dom/server',
  '@deepseek-ai/*',
]

await mkdir(tmpDir, { recursive: true })

try {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    jsxImportSource: 'react',
    external: EXTERNALS,
    outfile: tmpFile,
    sourcemap: false,
    minify: false,
    logLevel: 'warning',
  })

  const cjs = await readFile(tmpFile, 'utf8')
  const wrapped = [
    'window.__ModuleLoader__.load({',
    '  id: "' + PLUGIN_ID + '",',
    '  factory: (require) => {',
    '    var module = { exports: {} };',
    '    var exports = module.exports;',
    cjs.replace(/\n$/, ''),
    '    return module.exports;',
    '  }',
    '});',
    '',
  ].join('\n')

  await mkdir(outDir, { recursive: true })
  await writeFile(outFile, wrapped, 'utf8')
  console.log(`client bundle written: ${outFile} (${String(wrapped.length)} bytes)`)
} finally {
  await rm(tmpDir, { recursive: true, force: true })
}
