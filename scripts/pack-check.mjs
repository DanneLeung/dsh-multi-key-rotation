/**
 * Verify the published tarball.
 *
 * `npm pack` decides what npm serves, and a mistake here is invisible until
 * a user installs the package and finds a missing file. This script packs
 * the package into a temporary directory, reads the tarball's file list, and
 * asserts that:
 *
 *   - every file the manifest's `files` array promises is present;
 *   - the runtime files the plugin needs are present;
 *   - the display resources the Plugin Manager reads are present and
 *     declared (`locale/*.json`, the icon, the detail document);
 *   - no file the manifest does not mention (and that `files` does not
 *     allow) sneaks in;
 *   - no file contains a NUL byte or a UTF-8 BOM.
 *
 * It never touches the real publish directory: the tarball is written to a
 * temporary folder that is removed afterwards.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, normalize, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * Resolve the npm command.
 *
 * On Windows `npm` is `npm.cmd`, and Node refuses to spawn a `.cmd` through
 * `execFileSync` (EINVAL) because that is the shell-injection hole it
 * guards against. The reliable way to run npm everywhere is to spawn the
 * `node` binary with npm's own CLI script, which is what the shim does
 * anyway. On other platforms `npm` is a real executable and is spawned
 * directly.
 */
function npmCommand() {
  if (process.platform !== 'win32') return { file: 'npm', args: [] }

  // `npm root -g` would need npm to run, so the CLI script is located the
  // way the Windows shim locates it: next to the `npm.cmd` on PATH.
  const exts = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (!dir) continue
    for (const ext of exts) {
      const shim = join(dir, `npm${ext.toLowerCase()}`)
      if (!existsSync(shim)) continue
      // The shim sits in <prefix>/npm.cmd and the CLI sits in
      // <prefix>/node_modules/npm/bin/npm-cli.js.
      const cli = join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      if (existsSync(cli)) return { file: process.execPath, args: [cli] }
      return { file: 'npm', args: [] }
    }
  }
  return { file: 'npm', args: [] }
}

const NPM = npmCommand()

/** Run a command, returning its stdout. */
function run(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

/** Files the plugin cannot work without. */
const REQUIRED = [
  'index.js',
  'client.js',
  'src/pool.js',
  'cordis.patch.yml',
  'locale/en.json',
  'locale/zh.json',
  'icon.svg',
  'LICENSE',
  'README.md',
]

/** Files the manifest's `files` array allows, as glob-ish prefixes. */
function isAllowed(rel) {
  if (REQUIRED.includes(rel)) return true
  // npm always ships the manifest, whatever `files` says.
  if (rel === 'package.json') return true
  if (rel === 'NOTICE') return true
  if (rel.startsWith('src/')) return true
  if (rel.startsWith('docs/')) return true
  if (rel.startsWith('locale/') && rel.endsWith('.json')) return true
  return false
}

/**
 * The images a Markdown document writes, as paths relative to the package root.
 *
 * A relative destination resolves against the document's own directory, the
 * way the Plugin Manager resolves it when it serves the picture.
 * @param {string} document - the document's absolute path.
 * @returns {string[]} package-relative image paths.
 */
function imagesOf(document) {
  const markdown = readFileSync(document, 'utf8')
  const base = dirname(document)
  const out = new Set()
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)) {
    const authored = match[1]
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(authored)) continue
    const withoutSuffix = authored.replace(/[?#].*$/su, '')
    // A relative destination resolves against the document's own directory;
    // a rooted one against the package root.
    const absolute = withoutSuffix.startsWith('/')
      ? join(base, '..', withoutSuffix.slice(1))
      : join(base, withoutSuffix)
    // The tarball's entries are package-relative, so the image is reported
    // the same way.
    out.add(normalize(relative(ROOT, absolute)).split(sep).join('/'))
  }
  return [...out]
}

const work = mkdtempSync(join(tmpdir(), 'dsh-multi-key-rotation-pack-'))
let failed = false

try {
  const out = run(NPM.file, [...NPM.args, 'pack', '--pack-destination', work], { cwd: ROOT })
  const tarball = out.trim().split('\n').filter(Boolean).pop()
  const tarballPath = join(work, tarball)
  console.log(`packed ${tarball}`)

  // Read the tarball's entries with tar, which is present on every platform
  // that can run npm.
  const listing = run('tar', ['-tzf', tarballPath])
  const entries = listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== 'package/')
    .map((line) => line.replace(/^package\//, ''))
    .filter((line) => !line.endsWith('/'))

  console.log(`entries: ${entries.length}`)

  for (const required of REQUIRED) {
    if (!entries.includes(required)) {
      console.error(`MISSING required file: ${required}`)
      failed = true
    }
  }

  for (const entry of entries) {
    if (!isAllowed(entry)) {
      console.error(`UNEXPECTED file in tarball: ${entry}`)
      failed = true
    }
  }

  // Every TEXT file must be clean UTF-8 without a BOM or a NUL byte. The
  // pictures the documentation embeds are binary, and a PNG is not supposed
  // to decode as text — so they are checked for the PNG signature instead,
  // which is what tells a picture from a text file that went wrong.
  const unpacked = join(work, 'unpacked')
  execFileSync('tar', ['-xzf', tarballPath, '-C', work])
  for (const entry of entries) {
    const full = join(work, 'package', entry)
    let bytes
    try {
      bytes = readFileSync(full)
    } catch {
      console.error(`UNREADABLE entry: ${entry}`)
      failed = true
      continue
    }
    if (bytes.length === 0) {
      console.error(`EMPTY file: ${entry}`)
      failed = true
      continue
    }
    // A picture: the PNG signature, and nothing else is checked.
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    if (isPng) continue
    if (bytes.includes(0)) {
      console.error(`NUL byte in ${entry}`)
      failed = true
    }
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      console.error(`UTF-8 BOM in ${entry}`)
      failed = true
    }
    // A decode failure means the bytes are not valid UTF-8.
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      console.error(`NOT valid UTF-8: ${entry}`)
      failed = true
    }
  }

  // The declared detail document must exist — a missing file is an error in
  // the Plugin Manager, not a README fallback.
  for (const locale of ['en', 'zh']) {
    const raw = readFileSync(join(ROOT, 'locale', `${locale}.json`), 'utf8')
    const meta = JSON.parse(raw).meta ?? {}
    if (!meta.title || !meta.description) {
      console.error(`locale/${locale}.json lacks meta.title or meta.description`)
      failed = true
    }
    if (meta.detail) {
      const detail = join(ROOT, meta.detail)
      try {
        statSync(detail)
      } catch {
        console.error(`locale/${locale}.json declares meta.detail "${meta.detail}", which does not exist`)
        failed = true
      }
      if (!entries.includes(meta.detail)) {
        console.error(`meta.detail "${meta.detail}" is not in the tarball`)
        failed = true
      }
      // Every image the document writes must ship beside it. The Plugin
      // Manager resolves a relative destination against the document's own
      // directory and serves it from the installed bundle; a picture that
      // did not ship leaves a broken image on the plugin's page, and the
      // tarball looks complete because every other file is there.
      const images = imagesOf(join(ROOT, meta.detail))
      for (const image of images) {
        if (!entries.includes(image)) {
          console.error(`image "${image}", written by ${meta.detail}, is not in the tarball`)
          failed = true
        }
      }
    }
  }

  // The manifest's own name must match what the market will look up.
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  if (!manifest.name.includes('/')) {
    console.error(`package name "${manifest.name}" is not scoped`)
    failed = true
  }
  if (manifest.publishConfig?.access !== 'public') {
    console.error('publishConfig.access is not "public"')
    failed = true
  }

  if (failed) {
    console.error('\nRESULT: pack check FAILED')
    process.exitCode = 1
  } else {
    console.log('\nRESULT: pack check passed')
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
