/**
 * Release gate for the packed tarball.
 *
 * `pnpm run verify` proves the *source tree* builds and behaves; it says nothing
 * about what `pnpm pack` actually put in the archive. A published plugin fails
 * differently from a broken build: a missing `exports` target, an icon the
 * Plugin manager cannot read, or a `cordis.patch.yml` that points at a file the
 * tarball does not ship all surface as "the row never appears" — after install,
 * on someone else's machine.
 *
 * This script unpacks the tarball into `.verify/tarball-check/` and asserts the
 * archive is self-consistent: every path `package.json` advertises exists, the
 * files the Host and the browser half need are present, the manifest still
 * publishes all five endpoints, and nothing that should not ship (sources,
 * sourcemaps, tarballs, verification scratch) sneaked in.
 *
 * Usage:
 *   node scripts/verify-tarball.mjs                  # the version from package.json
 *   node scripts/verify-tarball.mjs path/to/x.tgz
 *
 * @module dsh-selection-translate/scripts/verify-tarball
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sandbox = join(root, '.verify', 'tarball-check')

const repoManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const archive = process.argv[2] ?? join(root, `${repoManifest.name}-${repoManifest.version}.tgz`)

await rm(sandbox, { recursive: true, force: true })
await mkdir(sandbox, { recursive: true })

const untar = spawnSync('tar', ['-xzf', archive, '-C', sandbox], { stdio: 'inherit' })
assert.equal(untar.status, 0, `tar could not extract ${archive}`)
const pkg = join(sandbox, 'package')

/** Every file in the unpacked package, package-relative and POSIX-shaped. */
async function listFiles(dir = pkg) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(full)))
    else out.push(relative(pkg, full).split('\\').join('/'))
  }
  return out
}

const shipped = new Set(await listFiles())

// ---------------------------------------------------------------- the manifest

const manifest = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'))
assert.equal(manifest.name, repoManifest.name, 'the tarball must carry the package name')
assert.equal(manifest.version, repoManifest.version, 'the tarball must carry the version being released')
assert.ok(!manifest.private, 'the package must stay publishable')
assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.includes('dsh-plugin'), 'a published DSH plugin declares keywords')
assert.ok(manifest.description.length > 40, 'the registry listing needs a real description')
assert.equal(manifest.license, 'MIT')

// -------------------------------------------------- every advertised path exists

/** Resolve one `exports` value (or bare path) against the package root. */
function expectFile(path, subject) {
  const clean = path.replace(/^\.\//, '')
  assert.ok(shipped.has(clean), `${subject} points at ${clean}, which the tarball does not ship`)
}

for (const [key, value] of Object.entries(manifest.exports)) {
  if (key.includes('*')) continue
  if (typeof value === 'string') {
    expectFile(value, `exports["${key}"]`)
    continue
  }
  for (const [condition, target] of Object.entries(value)) expectFile(target, `exports["${key}"].${condition}`)
}
expectFile(manifest.main, 'main')
expectFile(manifest.types, 'types')
expectFile(manifest.icon, 'icon')
expectFile(manifest.dsh.bundle.patch, 'dsh.bundle.patch')

// The locale files the plugin manager reads before activation.
for (const locale of ['en', 'zh']) expectFile(`locale/${locale}.json`, `locale/${locale}.json`)
const en = JSON.parse(await readFile(join(pkg, 'locale', 'en.json'), 'utf8'))
assert.equal(typeof en.meta?.title, 'string', 'the inventory title is what the Plugins page lists')

// --------------------------------------------------- the halves the Host loads

const client = await readFile(join(pkg, 'lib', 'client.js'), 'utf8')
assert.ok(client.startsWith('window.__ModuleLoader__.load({'), 'the browser half must keep the module-loader envelope')
assert.ok(client.includes(`id: ${JSON.stringify(manifest.name)}`), 'the module id must equal the package name')
assert.ok(client.includes('translateStream'), 'the browser half must carry the streaming path')

// Imported rather than grepped: endpoint strings are template literals in the
// bundle, so a text search proves nothing. This imports the shipped artifact and
// reads the manifest it actually builds. Resolution of `@deepseek-ai/*` comes
// from the repository's own node_modules, which is why this gate runs in-tree.
const hostArtifact = await import(pathToFileURL(join(pkg, 'lib', 'typert.host.js')).href)
assert.deepEqual(
  [...hostArtifact.TYPERT_ENDPOINTS].sort(),
  [
    'selectionTranslate/describePrompt',
    'selectionTranslate/limits',
    'selectionTranslate/saveSettings',
    'selectionTranslate/translate',
    'selectionTranslate/translateStream',
  ],
  'the shipped Host manifest must publish all five endpoints',
)
const invocations = hostArtifact.TYPERT.invocations
assert.equal(invocations.length, 5, 'the registry entry count must match the endpoint list')
const streamed = invocations.filter((invocation) => invocation.mode === 'stream')
assert.deepEqual(
  streamed.map((invocation) => invocation.method),
  ['translateStream'],
  'exactly one endpoint is a stream Remote',
)
assert.equal(hostArtifact.TYPERT.face, 'host', 'the artifact must keep its host face')
const types = await readFile(join(pkg, 'lib', 'types', 'index.d.ts'), 'utf8')
assert.ok(/SelectionTranslateService/.test(types), 'the published declarations must describe the Service class')

// The patch layer must name the package it inserts, or the row points nowhere.
const patch = await readFile(join(pkg, manifest.dsh.bundle.patch.replace(/^\.\//, '')), 'utf8')
assert.ok(patch.includes(`name: '${manifest.name}'`), 'cordis.patch.yml must insert this package')

// --------------------------------------------------------------- nothing extra

const forbidden = [
  { test: (file) => file.startsWith('src/'), why: 'TypeScript sources stay in the repository' },
  { test: (file) => file.endsWith('.map'), why: 'sourcemaps are not needed at runtime and only bloat the install' },
  { test: (file) => file.endsWith('.tgz'), why: 'a tarball must not nest the previous tarball' },
  { test: (file) => file.startsWith('.verify/') || file.startsWith('node_modules/'), why: 'local scratch must never be published' },
  { test: (file) => file.startsWith('scripts/'), why: 'build and verification scripts are repository-only' },
]
for (const file of shipped) {
  for (const rule of forbidden) assert.ok(!rule.test(file), `${file} shipped: ${rule.why}`)
}

// Documentation a reader of the installed package needs.
for (const doc of ['README.md', 'CHANGELOG.md', 'LICENSE']) {
  assert.ok(shipped.has(doc), `${doc} must ship with the package`)
}

console.log(`verify-tarball: ${archive}`)
console.log(`  ${shipped.size} files, version ${manifest.version}`)
console.log('  exports, icon, patch, locale, host manifest, client envelope: all consistent')
