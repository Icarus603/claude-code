#!/usr/bin/env bun
/**
 * flip-reverse-shim — move ownership of a reverse-shim from src/ into packages/.
 *
 * Usage:
 *   bun run scripts/flip-reverse-shim.ts <shim-path>
 *   bun run scripts/flip-reverse-shim.ts <shim-path> --force   (skip safety bail)
 *
 * What it does
 * ─────────────
 * 1. Read the shim file, find `export * from 'src/...'`.
 * 2. Read the canonical src target.
 * 3. Rewrite each `from '...'` import using a chain resolver:
 *    - relative `./X` or `../Y/X` → resolve to filesystem path; if that file
 *      is a forward shim (`export * from '@claude-code/...'`), rewrite to the
 *      package import. Otherwise bail (--force overrides).
 *    - absolute `src/X` → look up the file and apply same logic.
 *    - external / `@-` imports → leave untouched.
 * 4. Write rewritten content to the package shim path.
 * 5. Replace src target with a forward shim pointing to the package.
 *
 * Bails out (exit 3) when a dep chain doesn't terminate at a forward shim,
 * unless --force is passed (in which case the relative/src import is left
 * as-is and may need post-flip cleanup).
 */

import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, resolve } from 'path'

const args = process.argv.slice(2)
const force = args.includes('--force')
const shimPath = args.find(a => !a.startsWith('--'))
if (!shimPath) {
  console.error('Usage: bun run scripts/flip-reverse-shim.ts <shim-path> [--force]')
  process.exit(2)
}

const shim = await readFile(shimPath, 'utf8')
// Safety: refuse to flip a file > 100 LOC that has multiple `from 'src/'`
// exports — that's a real implementation that already absorbed a prior flip,
// not a shim. Treating it as a shim would overwrite the implementation with
// content from one of the src/* targets it merely re-exports a symbol from.
const shimLineCount = shim.split('\n').length
const allSrcExports = [...shim.matchAll(/export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s+['"](src\/[^'"]+)['"]/g)]
if (shimLineCount > 100 && allSrcExports.length >= 1) {
  console.error(`Refusing to flip ${shimPath}: file has ${shimLineCount} lines and ${allSrcExports.length} src export(s). This is likely a real implementation that re-exports a few symbols, not a thin shim. Either trim the src exports manually or add explicit override flag.`)
  process.exit(4)
}
const m = allSrcExports[0]
if (!m) {
  console.error(`No 'export {*|{...}} from src/...' pattern in ${shimPath}`)
  process.exit(2)
}

const repoRoot = process.cwd()
const srcImport = m[1]
const srcPath =
  resolveTs(repoRoot + '/' + srcImport) ??
  bail(`Canonical src target not found: ${srcImport}`)

const srcContent = await readFile(srcPath, 'utf8')

type Replacement = { from: string; to: string }
const replacements: Replacement[] = []
const unresolved: string[] = []

// Match `from '<spec>'` or `import('<spec>')` — capture the specifier.
const importRe = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g

const seen = new Set<string>()
let im: RegExpExecArray | null
importRe.lastIndex = 0
while ((im = importRe.exec(srcContent)) !== null) {
  const spec = im[1]
  if (seen.has(spec)) continue
  seen.add(spec)

  // Skip externals (no slash, or @scope/pkg form not @claude-code)
  if (!spec.startsWith('.') && !spec.startsWith('src/')) continue

  const resolvedPath = resolveSpec(spec, srcPath)
  if (!resolvedPath) {
    unresolved.push(`${spec} (could not resolve from ${srcPath})`)
    continue
  }

  // Chain through forward shims until we hit either a real file or a package.
  const finalPkg = followForwardShim(resolvedPath)
  if (!finalPkg) {
    unresolved.push(`${spec} (resolves to ${resolvedPath} — not a forward shim)`)
    continue
  }
  replacements.push({ from: spec, to: finalPkg })
}

// In force mode, rewrite unresolved relative imports to absolute src/
// paths so they still resolve via tsconfig path mapping after the move.
// They become runtime-boundaries violations but at least don't break.
const forced: Replacement[] = []
if (unresolved.length > 0) {
  if (!force) {
    console.error(`Cannot auto-flip ${shimPath}; unresolved deps:`)
    for (const u of unresolved) console.error('  ' + u)
    console.error('')
    console.error('Re-run with --force to rewrite to absolute src/... paths.')
    process.exit(3)
  }
  // Re-collect each unresolved spec → resolve to absolute src/ path.
  for (const u of unresolved) {
    const spec = u.split(' ')[0]
    if (!spec.startsWith('.')) continue // src/X already absolute, leave it
    const resolved = resolveSpec(spec, srcPath)
    if (!resolved) continue
    if (!resolved.startsWith(repoRoot + '/src/')) continue
    const absPath = resolved
      .slice((repoRoot + '/').length)
      .replace(/\.tsx?$/, '.js')
    forced.push({ from: spec, to: absPath })
  }
}

let newContent = srcContent
for (const r of [...replacements, ...forced]) {
  const escaped = r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Replace both `from '...'` and `import('...')` forms
  newContent = newContent.replace(
    new RegExp(`(from\\s+|import\\s*\\(\\s*)['"]${escaped}['"]`, 'g'),
    (_, prefix) => `${prefix}'${r.to}'`,
  )
}

await writeFile(shimPath, newContent)

const pkgImport = packageImportFor(shimPath)
const fwd = `// Forward shim — canonical owner is ${shimPath}.
// V7 reverse-shim flip: ownership moved from src/ to package.
export * from '${pkgImport}'
`
await writeFile(srcPath, fwd)

console.log(`✓ flipped ${shimPath}`)
console.log(`  ${srcPath} → forward shim`)
console.log(`  rewired ${replacements.length} imports`)
if (unresolved.length > 0) {
  console.log(`  ⚠ left ${unresolved.length} import(s) untouched (--force):`)
  for (const u of unresolved) console.log('    ' + u)
}

// ─────────────────────────────────────────────────────────────────────
function bail(msg: string): never { console.error(msg); process.exit(2) }

function resolveTs(p: string): string | null {
  if (p.endsWith('.ts') || p.endsWith('.tsx')) return existsSync(p) ? p : null
  const noExt = p.replace(/\.js$/, '')
  for (const c of [noExt + '.ts', noExt + '.tsx', noExt + '/index.ts', noExt + '/index.tsx']) {
    if (existsSync(c)) return c
  }
  return null
}

function resolveSpec(spec: string, fromFile: string): string | null {
  if (spec.startsWith('.')) {
    return resolveTs(resolve(dirname(fromFile), spec))
  }
  if (spec.startsWith('src/')) {
    return resolveTs(resolve(repoRoot, spec))
  }
  return null
}

function followForwardShim(filePath: string): string | null {
  const visited = new Set<string>()
  let current = filePath
  while (true) {
    if (visited.has(current)) return null
    visited.add(current)
    let content: string
    try { content = require('fs').readFileSync(current, 'utf8') } catch { return null }

    // Strip comments to avoid false positives from doc examples.
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    // Collect all `from '<spec>'` specifiers. A forward-shim is a tiny file
    // whose ONLY non-comment export targets a single package path.
    const exportFroms = [...stripped.matchAll(/export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g)]
    if (exportFroms.length === 0) return null

    const targets = exportFroms.map(m => m[1])
    // All targets must point to same package
    const allPkg = targets.every(t => t.startsWith('@claude-code/') || t.startsWith('@anthropic/'))
    if (allPkg) {
      // Heuristic: if multiple distinct package paths, return the first
      // (consumers can usually pick any). Most shims have just one.
      return targets[0]
    }
    // Mixed or src/relative chain — try following the first
    const first = targets[0]
    if (first.startsWith('src/') || first.startsWith('.')) {
      const next = resolveSpec(first, current)
      if (!next) return null
      current = next
      continue
    }
    return null
  }
}

function packageImportFor(pkgFilePath: string): string {
  // packages/foo/src/bar.ts → @claude-code/foo/bar.js
  // packages/foo/bar.ts     → @claude-code/foo/bar.js
  // packages/@ant/foo/src/bar.ts → @anthropic/foo/bar.js
  const ant = pkgFilePath.match(/^packages\/@ant\/([^/]+)\/(?:src\/)?(.+)\.tsx?$/)
  if (ant) return `@anthropic/${ant[1]}/${ant[2]}.js`
  const m = pkgFilePath.match(/^packages\/([^/]+)\/(?:src\/)?(.+)\.tsx?$/)
  if (!m) throw new Error(`Bad package path: ${pkgFilePath}`)
  return `@claude-code/${m[1]}/${m[2]}.js`
}
