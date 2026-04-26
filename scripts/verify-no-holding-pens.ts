#!/usr/bin/env bun
/**
 * verify-no-holding-pens — packages/* must not contain temporary holding-pen
 * directory names (`*_v7`, `*_dir`, `*_topdir`, `legacy_*`, `legacyUtils`,
 * `legacyImpl`, `*Dir`, `messages_iter*`, `utils_orphan`).
 *
 * V7 §3.1 — clean ownership requires meaningful names. Holding pens were
 * acceptable during transition; final state must not have them.
 */

import { readdirSync, statSync } from 'fs'
import { join } from 'path'

const PATTERNS = [
  /_v7$/,
  /_dir$/,
  /_topdir$/,
  /^legacy_/,
  /^legacyUtils$/,
  /^legacyImpl$/,
  /Dir$/,
  /^messages_iter\d+$/,
  /^utils_orphan$/,
]

// Allowed legacy/legacyImpl names that are real V7-correct subdomains
// (e.g. `@ant/computer-use-mcp/legacy/` represents the legacy impl flavor).
const ALLOWED = new Set([
  'packages/@ant/computer-use-mcp/src/legacy',
  'packages/shell/src/legacy', // shell legacy is a sub-domain
  'packages/provider/src/legacy', // provider legacy
])

function walk(dir: string, hits: string[]): void {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (!st.isDirectory()) continue
    if (ALLOWED.has(full)) { walk(full, hits); continue }
    if (PATTERNS.some(p => p.test(name))) {
      hits.push(full)
    }
    walk(full, hits)
  }
}

const hits: string[] = []
walk('packages', hits)
if (hits.length > 0) {
  console.error('Found holding-pen directories — V7 §3.1 requires meaningful names:')
  for (const h of hits) console.error('  ' + h)
  process.exit(1)
}
console.log('No holding-pen directories detected')
