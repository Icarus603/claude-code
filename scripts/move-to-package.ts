#!/usr/bin/env bun
/**
 * Move a directory of src/X files into a packages/Y location, replacing
 * src/X files with forward shims and adding package.json exports.
 *
 * Usage:
 *   bun run scripts/move-to-package.ts <src-dir> <pkg-dir>
 *
 * Example:
 *   bun run scripts/move-to-package.ts src/commands/install-github-app \
 *       packages/command-runtime/src/commands/install-github-app
 *
 * Behavior:
 *   - Copies every *.ts / *.tsx in <src-dir> (top-level only) to <pkg-dir>.
 *   - Rewrites relative imports `./X` `../Y` that resolve into src/ to
 *     absolute `src/...` form so they stay valid at the new location.
 *   - Replaces src/ files with forward shims `export * from '@cc/<pkg>/<name>.js'`.
 *   - Updates the target package's package.json `exports` map.
 *   - Skips files that already start with `// Forward shim` (idempotent).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'fs'
import { dirname, resolve, relative, join, basename, extname } from 'path'

const args = process.argv.slice(2)
if (args.length !== 2) {
  console.error('Usage: bun run scripts/move-to-package.ts <src-dir> <pkg-dir>')
  process.exit(2)
}
const [srcDir, pkgDir] = args
const repoRoot = process.cwd()

if (!existsSync(srcDir)) {
  console.error(`src dir not found: ${srcDir}`)
  process.exit(2)
}
mkdirSync(pkgDir, { recursive: true })

// Locate package.json by walking up from pkgDir.
function findPackageJson(start: string): string {
  let dir = resolve(start)
  while (dir !== '/' && !existsSync(join(dir, 'package.json'))) {
    dir = dirname(dir)
  }
  const pj = join(dir, 'package.json')
  if (!existsSync(pj)) throw new Error(`No package.json found above ${start}`)
  return pj
}
const pkgJsonPath = findPackageJson(pkgDir)
const pkgRoot = dirname(pkgJsonPath)
const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
const pkgName = pkg.name as string
const subPath = relative(pkgRoot, pkgDir).replace(/^src\//, '') // sub-path from package root, without leading src/

const files = readdirSync(srcDir)
  .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
  .filter(f => !statSync(join(srcDir, f)).isDirectory())

let moved = 0
const newExports: Record<string, string> = {}

for (const f of files) {
  const srcFile = join(srcDir, f)
  const pkgFile = join(pkgDir, f)
  const content = readFileSync(srcFile, 'utf8')

  if (content.startsWith('// Forward shim')) continue
  if (existsSync(pkgFile) && !readFileSync(pkgFile, 'utf8').includes('Thin alias')) {
    console.warn(`SKIP ${f}: ${pkgFile} already exists with content`)
    continue
  }

  // Rewrite relative imports that resolve into src/ → absolute src/...
  const rewritten = content.replace(
    /(from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g,
    (full, prefix, spec) => {
      if (!spec.startsWith('.')) return full
      const resolved = resolve(dirname(srcFile), spec)
      const rel = relative(repoRoot, resolved)
      if (!rel.startsWith('src/')) return full
      // Drop trailing .js if present (TS resolution will pick .ts)
      return `${prefix}'${rel}'`
    },
  )

  writeFileSync(pkgFile, rewritten)

  // Forward shim in src/
  const ext = extname(f)
  const base = basename(f, ext)
  const exportKey = `./${subPath ? subPath + '/' : ''}${base}.js`
  const shimContent = `// Forward shim — canonical owner is ${relative(repoRoot, pkgFile)}.
// V7 batch move via scripts/move-to-package.ts.
export * from '${pkgName}/${subPath ? subPath + '/' : ''}${base}.js'
`
  writeFileSync(srcFile, shimContent)

  // Track exports
  newExports[exportKey] = `./${relative(pkgRoot, pkgFile)}`
  moved++
}

// Update package.json exports
if (Object.keys(newExports).length > 0) {
  pkg.exports = pkg.exports || {}
  Object.assign(pkg.exports, newExports)
  writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n')
}

console.log(`Moved ${moved} files from ${srcDir} → ${pkgDir}`)
for (const [k, v] of Object.entries(newExports)) {
  console.log(`  ${k} → ${v}`)
}
