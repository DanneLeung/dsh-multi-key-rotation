/**
 * Build a distributable ZIP of the plugin.
 *
 * The ZIP carries exactly the file set `npm pack` produces — the same list
 * the manifest's `files` array promises — so a user who unpacks it and points
 * DSH at the folder gets byte-identical content to the npm tarball. The
 * archive holds a single top-level directory named after the package, so
 * unpacking it never scatters files into the current directory.
 *
 * Usage: node scripts/make-zip.mjs [--out <dir>]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const PKG_DIR = 'dsh-multi-key-rotation'

/** Parse `--out <dir>`; default is the repository's `dist/`. */
function parseOut(argv) {
  const i = argv.indexOf('--out')
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : join(ROOT, 'dist')
}

/**
 * Expand one `files` entry into the concrete relative paths it covers.
 * Only the glob shapes the manifest actually uses are supported: a directory
 * prefix (recursively) and a `*.ext` pattern inside one directory.
 */
function expand(entry) {
  const abs = join(ROOT, entry.replace(/\*\.json$/, ''))
  if (!existsSync(abs)) return []
  const st = statSync(abs)
  if (st.isFile()) return [entry]
  const out = []
  const walk = (dir, prefix) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) walk(join(dir, e.name), rel)
      else if (entry.endsWith('*.json')) {
        if (e.name.endsWith('.json')) out.push(rel)
      } else {
        out.push(rel)
      }
    }
  }
  walk(abs, entry.replace(/\/\*\.json$/, ''))
  return out
}

/** Collect the published file set. */
function publishedFiles() {
  const files = new Set(['package.json']) // npm always ships the manifest
  for (const entry of manifest.files ?? []) {
    for (const f of expand(entry)) files.add(f)
  }
  // `NOTICE` is shipped by npm as a sibling of the manifest.
  if (existsSync(join(ROOT, 'NOTICE'))) files.add('NOTICE')
  return [...files].sort()
}

/** PowerShell's Compress-Archive is available on every Windows box; use it. */
function zipWithCompressArchive(sourceDir, outFile) {
  const ps = [
    '$ErrorActionPreference = "Stop"',
    `$src = '${sourceDir.replace(/'/g, "''")}'`,
    `$out = '${outFile.replace(/'/g, "''")}'`,
    'if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }',
    'Compress-Archive -Path (Join-Path $src "*") -DestinationPath $out -CompressionLevel Optimal',
  ].join('; ')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' })
}

const outDir = parseOut(process.argv.slice(2))
const files = publishedFiles()

console.log(`published file set (${files.length}):`)
for (const f of files) console.log(`  ${f}`)

// Stage the files into a temporary tree named after the package.
const stage = mkdtempSync(join(tmpdir(), 'dsh-zip-'))
const stagePkg = join(stage, PKG_DIR)
mkdirSync(stagePkg, { recursive: true })

for (const rel of files) {
  const from = join(ROOT, rel)
  const to = join(stagePkg, rel)
  mkdirSync(dirname(to), { recursive: true })
  execFileSync('cmd', ['/c', 'copy', '/y', from, to], { stdio: 'ignore' })
}

mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, `${PKG_DIR}-${manifest.version}.zip`)
zipWithCompressArchive(stagePkg, outFile)
rmSync(stage, { recursive: true, force: true })

const st = statSync(outFile)
console.log(`\nwrote ${outFile}`)
console.log(`size ${st.size} bytes`)

// Verify: list the archive back and compare against the file set.
const listing = execFileSync('tar', ['-tf', outFile], { encoding: 'utf8' })
const zipped = listing.split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => l.replace(/^dsh-multi-key-rotation[\\/]/, '').replace(/[\\/]+$/, ''))
  .filter(Boolean)
  .sort()
const missing = files.filter((f) => !zipped.includes(f))
const extra = zipped.filter((f) => !files.includes(f))
if (missing.length || extra.length) {
  console.error(`zip mismatch: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`)
  process.exitCode = 1
} else {
  console.log(`zip verified: ${zipped.length} entries match the published file set`)
}
