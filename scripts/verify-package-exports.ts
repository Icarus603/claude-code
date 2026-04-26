#!/usr/bin/env bun
/**
 * verify-package-exports — every `from '@claude-code/<X>/<sub>.js'` import
 * across the repo must resolve through that package's `package.json` exports
 * map. Catches the "added a new module under packages/X but forgot the
 * export entry" failure mode statically, before `bun build` blows up.
 *
 * Why static? `verify-build-resolves` runs the bundler from cli.tsx, so it
 * only catches paths reached from the CLI entry. Tests, scripts, and code
 * paths behind feature flags can still ship broken specifiers. This check
 * is purely textual + JSON, no bundler involvement.
 */

import { readFile } from 'fs/promises'
import { Glob } from 'bun'

type ExportsMap = Record<string, string | Record<string, string>>

const SCAN_GLOBS = [
  'src/**/*.{ts,tsx}',
  'packages/**/*.{ts,tsx}',
  'tests/**/*.{ts,tsx}',
  'scripts/**/*.ts',
]

// Match `from '...'`, `import('...')`, `require('...')` — but NOT
// `typeof import('...')` (TS type-level, no runtime resolution).
const IMPORT_RE =
  /(?<!typeof\s)(?<!typeof\s\s)(?:\bfrom\b|\bimport\b|\brequire\b)\s*\(?\s*['"](@claude-code\/[^'"\s)]+)['"]/g

async function readPackageExports(pkg: string): Promise<ExportsMap | null> {
  try {
    const json = JSON.parse(await readFile(`packages/${pkg}/package.json`, 'utf8'))
    return json.exports ?? null
  } catch {
    return null
  }
}

function specMatchesExports(specSubpath: string, exportsMap: ExportsMap): boolean {
  const candidate = './' + specSubpath
  if (candidate in exportsMap) return true
  for (const key of Object.keys(exportsMap)) {
    if (!key.includes('*')) continue
    const re = new RegExp(
      '^' + key.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.*)') + '$',
    )
    if (re.test(candidate)) return true
  }
  return false
}

const violations: { file: string; spec: string; reason: string }[] = []
const seen = new Set<string>()
const exportsCache = new Map<string, ExportsMap | null>()

for (const pattern of SCAN_GLOBS) {
  for await (const file of new Glob(pattern).scan('.')) {
    if (file.includes('node_modules/')) continue
    const content = await readFile(file, 'utf8')
    let m: RegExpExecArray | null
    IMPORT_RE.lastIndex = 0
    while ((m = IMPORT_RE.exec(content))) {
      const spec = m[1]
      const key = `${file}::${spec}`
      if (seen.has(key)) continue
      seen.add(key)
      const stripped = spec.replace(/^@claude-code\//, '')
      const slash = stripped.indexOf('/')
      // Bare "@claude-code/X" — main export, always covered.
      if (slash === -1) continue
      const pkg = stripped.slice(0, slash)
      const subpath = stripped.slice(slash + 1)
      // Scoped sub-pkg (e.g., @claude-code/repl/screens/X) — same logic.
      if (!exportsCache.has(pkg)) {
        exportsCache.set(pkg, await readPackageExports(pkg))
      }
      const exportsMap = exportsCache.get(pkg)
      if (exportsMap == null) continue // package not in monorepo (external)
      if (!specMatchesExports(subpath, exportsMap)) {
        violations.push({ file, spec, reason: `no matching exports key for ./${subpath}` })
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`✗ package-exports: ${violations.length} unresolvable import(s):`)
  for (const v of violations.slice(0, 30)) {
    console.error(`  ${v.file} → ${v.spec} (${v.reason})`)
  }
  if (violations.length > 30) {
    console.error(`  ... and ${violations.length - 30} more`)
  }
  console.error(
    '\nFix by adding an entry to the package\'s package.json `exports` map.',
  )
  process.exit(1)
}
console.log('package-exports check passed')
