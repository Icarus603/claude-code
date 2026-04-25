#!/usr/bin/env bun
/**
 * verify-require-src-imports — detect hidden runtime require()/import()
 * calls from packages/ back into src/.
 *
 * Static-import boundary checks (verify-runtime-boundaries.ts) only see
 * `from 'src/...'` patterns. The complementary surface — `require('src/...')`
 * and `await import('src/...')` — bypasses static analysis entirely.
 * As of audit 2026-04-26, packages/ contained 294 such hidden references.
 *
 * V7 §3.1 (Owner Over Shim) and §3.2 (Ports And Adapters) require packages
 * to depend on contracts, not on src/ directly. This check is the runtime
 * counterpart to runtime-boundaries.
 *
 * Usage:
 *   bun run scripts/verify-require-src-imports.ts
 *   bun run scripts/verify-require-src-imports.ts --budget   # baseline mode
 */

import { readFile } from 'fs/promises'

const PATTERNS = [
  /require\(\s*['"]src\//g,
  /require\(\s*['"]\.\.\/src\//g,
  /(?:await\s+)?import\(\s*['"]src\//g,
  /(?:await\s+)?import\(\s*['"]\.\.\/src\//g,
]

// Per-package ratchet baseline as of iter 8 (2026-04-26). Down from
// initial 415 hits → 241. Reduce these as flips land; don't increase.
const BUDGET: Record<string, number> = {
  // Hard ratchet to current actual values (iter 19). Future iterations
  // must drive these down monotonically; CI fails on any regression.
  'packages/@ant': 95,
  'packages/agent': 53,
  'packages/app-host': 33,
  'packages/cli': 22,
  'packages/tool-registry': 11,
  'packages/repl': 11,
  'packages/mcp-runtime': 8,
  'packages/bridge': 4,
  'packages/provider': 2,
  'packages/command-runtime': 3,
  'packages/permission': 3,
  'packages/output': 1,
  'packages/voice': 1,
  'packages/headless-sdk': 5,
  'packages/swarm': 5,
  'packages/storage': 5,
  'packages/local-observability': 5,
  'packages/ide': 5,
  'packages/teleport': 5,
  'packages/updater': 5,
  'packages/daemon': 5,
  'packages/server': 5,
  'packages/shell': 5,
  'packages/config': 5,
  'packages/command-runtime': 5,
  'packages/memory': 5,
}

async function collectFiles(): Promise<string[]> {
  const proc = Bun.spawn([
    'find', 'packages', '-type', 'f',
    '(', '-name', '*.ts', '-o', '-name', '*.tsx', '-o', '-name', '*.js', ')',
    '-not', '-path', '*/node_modules/*',
    '-not', '-path', '*/dist/*',
  ], { stdout: 'pipe' })
  const out = await new Response(proc.stdout).text()
  return out.split('\n').map(s => s.trim()).filter(Boolean)
}

function packageOf(file: string): string | null {
  const m = file.match(/^(packages\/[^/]+(?:\/src)?)/)
  return m ? m[1].replace(/\/src$/, '') : null
}

async function main() {
  const files = await collectFiles()
  const perPkg = new Map<string, Array<{ file: string; line: number; pattern: string }>>()

  for (const f of files) {
    let content: string
    try { content = await readFile(f, 'utf8') } catch { continue }
    for (const pat of PATTERNS) {
      pat.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pat.exec(content)) !== null) {
        const pre = content.slice(0, m.index)
        const line = pre.split('\n').length
        const pkg = packageOf(f) ?? '(unknown)'
        const arr = perPkg.get(pkg) ?? []
        arr.push({ file: f, line, pattern: m[0] })
        perPkg.set(pkg, arr)
      }
    }
  }

  let total = 0
  let overBudget = 0
  const lines: string[] = []
  for (const [pkg, hits] of [...perPkg.entries()].sort((a, b) => b[1].length - a[1].length)) {
    total += hits.length
    const budget = BUDGET[pkg] ?? 0
    const status = hits.length <= budget ? 'OK' : 'OVER'
    if (status === 'OVER') overBudget++
    lines.push(`${status.padEnd(5)} ${pkg.padEnd(30)} ${hits.length} hits (budget ${budget})`)
  }

  console.log(lines.join('\n'))
  console.log('')
  console.log(`Total hidden require/import('src/...') from packages: ${total}`)
  console.log(`Packages over budget: ${overBudget}`)

  if (overBudget > 0) {
    console.log('')
    console.log('Top 30 violations:')
    const all = [...perPkg.values()].flat().slice(0, 30)
    for (const v of all) {
      console.log(`  ${v.file}:${v.line}  ${v.pattern}...`)
    }
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(2) })
