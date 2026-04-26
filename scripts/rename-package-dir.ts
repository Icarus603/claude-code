#!/usr/bin/env bun
/**
 * Rename a holding-pen directory inside a package to its V7-correct name.
 *
 * Usage:
 *   bun run scripts/rename-package-dir.ts <pkg-old-path> <pkg-new-path>
 *   e.g. scripts/rename-package-dir.ts \
 *          packages/storage/src/filePersistenceDir \
 *          packages/storage/src/filePersistence
 *
 * What it does:
 *   1. mv old-path new-path (with merge if new-path already exists)
 *   2. Update the owning package.json exports map (key + value)
 *   3. Sed-rewrite all imports across `packages/` and `src/` from
 *      @claude-code/<pkg>/<old-suffix> → @claude-code/<pkg>/<new-suffix>
 *   4. Same for relative imports inside the package (./oldDir/X → ./newDir/X)
 */

import { existsSync, readdirSync, statSync, mkdirSync, renameSync, rmdirSync, readFileSync, writeFileSync } from 'fs'
import { join, relative, dirname } from 'path'

const args = process.argv.slice(2)
if (args.length !== 2) {
  console.error('Usage: bun run scripts/rename-package-dir.ts <old> <new>')
  process.exit(2)
}
const [oldPath, newPath] = args
if (!existsSync(oldPath)) { console.error(`old not found: ${oldPath}`); process.exit(2) }

// Find owning package
function findPkgRoot(p: string): string {
  let d = p
  while (d !== '/' && !existsSync(join(d, 'package.json'))) d = dirname(d)
  if (!existsSync(join(d, 'package.json'))) throw new Error('no pkg root')
  return d
}
const pkgRoot = findPkgRoot(oldPath)
const pkgJsonPath = join(pkgRoot, 'package.json')
const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
const pkgName = pkg.name as string

// Compute import path segments (strip pkgRoot/src/ prefix)
function importSeg(p: string): string {
  const rel = relative(pkgRoot, p).replace(/^src\//, '')
  return rel
}
const oldSeg = importSeg(oldPath)
const newSeg = importSeg(newPath)

// Move/merge files
function copyMerge(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const name of readdirSync(src)) {
    const sp = join(src, name)
    const dp = join(dst, name)
    const st = statSync(sp)
    if (st.isDirectory()) {
      copyMerge(sp, dp)
    } else {
      if (existsSync(dp)) {
        console.warn(`  skipping ${dp} (target exists)`)
      } else {
        renameSync(sp, dp)
      }
    }
  }
  // Try to remove src if empty
  try {
    if (readdirSync(src).length === 0) rmdirSync(src)
  } catch {}
}
copyMerge(oldPath, newPath)

// Update package.json exports
const newExports: Record<string, string> = {}
for (const [k, v] of Object.entries(pkg.exports ?? {})) {
  let nk = k
  let nv = v as string
  // Replace `./oldSeg/` with `./newSeg/` in keys (subpath exports)
  if (nk.startsWith(`./${oldSeg}/`) || nk === `./${oldSeg}`) {
    nk = nk.replace(`./${oldSeg}`, `./${newSeg}`)
  }
  if (typeof nv === 'string' && nv.includes(`/${oldSeg}/`)) {
    nv = nv.replace(`/${oldSeg}/`, `/${newSeg}/`)
  }
  // Also handle src/ prefixed values
  if (typeof nv === 'string' && (nv.endsWith(`/${oldSeg}`) || nv.startsWith(`./src/${oldSeg}/`))) {
    nv = nv.replace(`/${oldSeg}`, `/${newSeg}`)
  }
  newExports[nk] = nv
}
pkg.exports = newExports
writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n')

// Sed rewrite imports across packages/ and src/
import { execSync } from 'child_process'
function sedAll(from: string, to: string): void {
  // Use python instead of sed to avoid quoting issues with apostrophes/slashes.
  const py = `
import os, re
for root, _, files in os.walk('packages'):
  if 'node_modules' in root or 'dist' in root: continue
  for f in files:
    if not (f.endswith('.ts') or f.endswith('.tsx')): continue
    p = os.path.join(root, f)
    try: c = open(p).read()
    except: continue
    if ${JSON.stringify(from)} not in c: continue
    c2 = c.replace(${JSON.stringify(from)}, ${JSON.stringify(to)})
    if c2 != c:
      open(p, 'w').write(c2)
for root, _, files in os.walk('src'):
  if 'node_modules' in root: continue
  for f in files:
    if not (f.endswith('.ts') or f.endswith('.tsx')): continue
    p = os.path.join(root, f)
    try: c = open(p).read()
    except: continue
    if ${JSON.stringify(from)} not in c: continue
    c2 = c.replace(${JSON.stringify(from)}, ${JSON.stringify(to)})
    if c2 != c:
      open(p, 'w').write(c2)
`
  try { execSync(`python3 -c ${JSON.stringify(py)}`) } catch (e) { console.error('sed err', e) }
}
// Package import rewrite: @claude-code/foo/oldSeg/  →  @claude-code/foo/newSeg/
const oldImport = `${pkgName}/${oldSeg}/`
const newImport = `${pkgName}/${newSeg}/`
sedAll(oldImport, newImport)
// Relative import rewrite inside package: ./oldDirName/  →  ./newDirName/
const oldDirName = oldSeg.split('/').pop()!
const newDirName = newSeg.split('/').pop()!
if (oldDirName !== newDirName) {
  sedAll(`/${oldDirName}/`, `/${newDirName}/`)
  sedAll(`'./${oldDirName}/`, `'./${newDirName}/`)
  sedAll(`"./${oldDirName}/`, `"./${newDirName}/`)
}

console.log(`Renamed ${oldPath} → ${newPath}`)
console.log(`  pkg import: ${oldImport} → ${newImport}`)
