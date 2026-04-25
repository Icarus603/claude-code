#!/usr/bin/env bun
/**
 * Find `from 'src/X.js'` imports in packages/ where src/X is a forward
 * shim, and rewrite them to the canonical package path. Pure import-notation
 * cleanup — no runtime semantics change because the chain resolves identically
 * either way.
 *
 * Drops verify-runtime-boundaries violations without touching ownership.
 */

import { readFile, writeFile } from 'fs/promises'
import { existsSync, readFileSync, statSync } from 'fs'
import { resolve } from 'path'

const repoRoot = process.cwd()

function resolveTs(p: string): string | null {
  // If exact path with extension exists AND is a file, use it.
  if ((p.endsWith('.ts') || p.endsWith('.tsx')) && existsSync(p)) {
    try { if (statSync(p).isFile()) return p } catch {}
  }
  // Try sibling .ts / .tsx
  for (const ext of ['.ts', '.tsx']) {
    const candidate = p + ext
    if (existsSync(candidate)) {
      try { if (statSync(candidate).isFile()) return candidate } catch {}
    }
  }
  // Try /index.ts inside dir
  for (const idx of ['/index.ts', '/index.tsx']) {
    const candidate = p + idx
    if (existsSync(candidate)) {
      try { if (statSync(candidate).isFile()) return candidate } catch {}
    }
  }
  return null
}

function followShim(filePath: string): string | null {
  const visited = new Set<string>()
  let current = filePath
  while (true) {
    if (visited.has(current)) return null
    visited.add(current)
    let content: string
    try { content = readFileSync(current, 'utf8') } catch { return null }
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // Collect any `export ... from 'X'` (including named, type, *).
    const exportFroms = [...stripped.matchAll(/export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/g)]
    // Also collect re-export-as-import-then-export patterns (rarer)
    if (exportFroms.length === 0) return null
    // Check no implementation lines (functions, consts) — pure shim
    const hasImpl = stripped
      .split('\n')
      .some(line => {
        const t = line.trim()
        if (t === '') return false
        if (t.startsWith('export ') || t.startsWith('import ') || t.startsWith('type ')) return false
        // Allow continuation lines from multi-line exports
        if (t.startsWith('}') || t.startsWith('{') || t.endsWith(',') || t === ',') return false
        if (/^['"]|['"][\s,]*$/.test(t)) return false
        return true
      })
    if (hasImpl) return null
    const targets = exportFroms.map(m => m[1])
    // Accept if all targets resolve to a single package (or @anthropic).
    if (targets.every(t => t.startsWith('@claude-code/') || t.startsWith('@anthropic/'))) {
      // If multiple distinct package paths, the file aggregates from several
      // packages — we can't simply rewrite a single import to one package.
      // Return the first only if all share the same package prefix.
      const pkgPrefixes = new Set(targets.map(t => t.split('/').slice(0, 2).join('/')))
      if (pkgPrefixes.size === 1) return targets[0]
      // Multi-package aggregator — caller should not auto-rewrite.
      return null
    }
    // Recurse if first target points back into src/ or relative.
    const first = targets[0]
    if (first.startsWith('src/') || first.startsWith('.')) {
      const next = first.startsWith('.')
        ? resolve(repoRoot, current.replace(/[^/]+$/, ''), first)
        : resolve(repoRoot, first)
      const resolved = resolveTs(next)
      if (!resolved) return null
      current = resolved
      continue
    }
    return null
  }
}

async function collectFiles(): Promise<string[]> {
  const proc = Bun.spawn([
    'find', 'packages', '-type', 'f',
    '(', '-name', '*.ts', '-o', '-name', '*.tsx', ')',
    '-not', '-path', '*/node_modules/*',
    '-not', '-path', '*/dist/*',
    '-not', '-path', '*/__tests__/*',
  ], { stdout: 'pipe' })
  const out = await new Response(proc.stdout).text()
  return out.split('\n').map(s => s.trim()).filter(Boolean)
}

const dryRun = process.argv.includes('--dry-run')

const files = await collectFiles()
let totalRewrites = 0
let touchedFiles = 0

for (const f of files) {
  let content: string
  try { content = await readFile(f, 'utf8') } catch { continue }
  let rewrites = 0
  const newContent = content.replace(
    /(from\s+|import\s*\(\s*|require\s*\(\s*)['"](src\/[^'"]+)['"]/g,
    (full, prefix, spec) => {
      const cleaned = spec.replace(/\.js$/, '')
      const tsPath = resolveTs(`${repoRoot}/${cleaned}`)
      if (!tsPath) return full
      const pkg = followShim(tsPath)
      if (!pkg) return full
      rewrites++
      return `${prefix}'${pkg}'`
    },
  )
  if (rewrites > 0) {
    if (!dryRun) await writeFile(f, newContent)
    touchedFiles++
    totalRewrites += rewrites
    console.log(`${dryRun ? '[dry] ' : ''}${f}: ${rewrites} rewrites`)
  }
}

console.log(`\n${dryRun ? 'Would rewrite' : 'Rewrote'} ${totalRewrites} imports across ${touchedFiles} files`)
