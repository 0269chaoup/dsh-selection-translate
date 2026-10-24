/**
 * Build driver.
 *
 * Two outputs, because a DSH plugin is two halves:
 *
 * - **Host half** — `lib/index.js`, `lib/typert.host.js`, `lib/typert.remote.js`:
 *   plain Node ESM. Every `@deepseek-ai/*` package and `zod` stay external so the
 *   Host resolves the copies its own composition already loaded; only this
 *   package's own modules are inlined.
 * - **Browser half** — `lib/client.js`: one file in the shell's module-loader
 *   format (`window.__ModuleLoader__.load({ id, factory(require) })`). React stays
 *   external (the shell owns the single React copy in its module table); the
 *   Typert protocol leaf and Zod are bundled so the browser needs no extra
 *   module-table entry and no `dsh.client.external` declaration.
 *
 * `lib/types/**` comes from `tsc -p tsconfig.build.json`, which runs first so a
 * type error fails the build before any JavaScript is emitted.
 *
 * @module dsh-selection-translate/scripts/build
 */

import { spawnSync } from 'node:child_process'
import { rm, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = join(root, 'lib')

/** Packages the Host composition supplies at runtime. */
const HOST_EXTERNAL = ['@deepseek-ai/*', 'zod', 'node:*']

/** Packages the shell's browser module table supplies at runtime. */
const CLIENT_EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'node:*']

/** Shared esbuild options. */
const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: 'warning',
  target: 'es2022',
  legalComments: 'none',
}

/** Run the declaration build. */
function emitDeclarations() {
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error('declaration build failed: see the tsc output above')
}

/** Read the package name, which is also the Client module id. */
async function packageName() {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  return manifest.name
}

/** Build the three Host artifacts. */
async function buildHost() {
  await build({
    ...shared,
    entryPoints: [join(root, 'src/index.ts')],
    outfile: join(lib, 'index.js'),
    format: 'esm',
    platform: 'node',
    external: HOST_EXTERNAL,
  })
  await build({
    ...shared,
    entryPoints: [join(root, 'src/typert.host.ts')],
    outfile: join(lib, 'typert.host.js'),
    format: 'esm',
    platform: 'node',
    external: HOST_EXTERNAL,
  })
  await build({
    ...shared,
    entryPoints: [join(root, 'src/typert.remote.ts')],
    outfile: join(lib, 'typert.remote.js'),
    format: 'esm',
    platform: 'neutral',
    external: HOST_EXTERNAL,
  })
}

/**
 * Build the browser bundle.
 *
 * The banner opens the module-loader envelope and the footer closes it, so the
 * emitted file *is* the served artifact: the shell evaluates it, receives a
 * `{ inject, apply }` module object, and calls `apply` with the Client root
 * context.
 * @param id - module id, which must equal the package name.
 */
async function buildClient(id) {
  await build({
    ...shared,
    entryPoints: [join(root, 'src/client/index.tsx')],
    outfile: join(lib, 'client.js'),
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    external: CLIENT_EXTERNAL,
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: {
      js: [
        'window.__ModuleLoader__.load({',
        `\tid: ${JSON.stringify(id)},`,
        '\tfactory: (require) => {',
        '\t\tvar module = { exports: {} };',
        '\t\tvar exports = module.exports;',
        '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
      ].join('\n'),
    },
    footer: {
      js: ['\t\treturn module.exports;', '\t}', '});', ''].join('\n'),
    },
  })
}

async function main() {
  await rm(lib, { recursive: true, force: true })
  await mkdir(lib, { recursive: true })
  emitDeclarations()
  await buildHost()
  await buildClient(await packageName())
  process.stdout.write('built lib/index.js, lib/client.js, lib/typert.host.js, lib/typert.remote.js, lib/types/**\n')
}

await main()
