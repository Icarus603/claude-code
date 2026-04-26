#!/usr/bin/env bun
/**
 * verify-src-shrinks — non-test, non-entrypoint LOC in src/ must decrease.
 *
 * Excludes:
 *   - src/entrypoints/**     (true entry points: cli.tsx, init.ts, mcp.ts, sdk facades)
 *   - src/main.tsx           (thin host)
 *
 * Counts everything else: forward shims, residual implementations, etc.
 * The goal is `0` — when this hits zero, src/ is fully evacuated except
 * for entrypoints. Until then, every commit must drive it down.
 */

import { readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'

const BUDGET = 3342 // iter 6 baseline (excluding entrypoints + main.tsx)
const EXCLUDE_PREFIXES = ['src/entrypoints/', 'src/main.tsx']

function walk(dir: string, files: string[]): void {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) walk(full, files)
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) files.push(full)
  }
}

const files: string[] = []
walk('src', files)
const filtered = files.filter(f =>
  !EXCLUDE_PREFIXES.some(p => f === p || f.startsWith(p))
)

let total = 0
for (const f of filtered) {
  total += readFileSync(f, 'utf8').split('\n').length
}

if (total > BUDGET) {
  console.error(
    `src/ non-entrypoint LOC = ${total} (budget ${BUDGET}). V7 §3.1: src/ ` +
    `must shrink to entrypoints + facades only. Move impl to packages/.`,
  )
  process.exit(1)
}
console.log(`src/ non-entrypoint LOC: ${total} (budget ${BUDGET})`)
