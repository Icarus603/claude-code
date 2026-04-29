#!/usr/bin/env bun
/**
 * verify-deps-quality — ratchet quality metrics on packages/config/plugin/_deps.ts.
 *
 * Two ratchets, both monotonically-shrink-only:
 *   1. Lazy-require count: number of `// eslint-disable-next-line ... no-require-imports`
 *      comments inside _deps.ts. Each one is a runtime workaround for a
 *      static-import cycle. Goal is zero (or as close as possible — some
 *      genuinely cross-cutting deps stay).
 *   2. Unknown-typed slot count: number of `let _<name>: unknown = ...`
 *      declarations. Each one is a setter slot whose return type the file
 *      gave up on; usually a sign that the contract should live in a
 *      dedicated types package.
 *
 * Tighten with `--tighten`: locks the current values as new baselines.
 * Run after a real reduction.
 *
 * Why ratchet: lazy-require and unknown-slot are the two recurring
 * anti-patterns in _deps.ts. The 2026-04-29 cycle-break work brought
 * lazy-require from 11 to 3 by moving leaf utilities into config; this
 * verifier locks the gain so the next refactor can't accidentally
 * regress.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const DEPS_FILE = join(REPO_ROOT, 'packages/config/plugin/_deps.ts')
const BASELINE_FILE = join(
  REPO_ROOT,
  'scripts/deps-quality-baseline.json',
)

interface Baseline {
  lazyRequires: number
  unknownSlots: number
}

function loadBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  } catch {
    return { lazyRequires: 0, unknownSlots: 0 }
  }
}

function countLazyRequires(content: string): number {
  // Count cross-package lazy-requires — pairs of (eslint-disable comment,
  // require() call to a @claude-code/* package) on adjacent lines. These
  // are the cycle-workaround entries we want to drive to zero.
  //
  // Excludes `require('node:fs')` style — those aren't cycle workarounds,
  // they're build-target shims (only loaded at host boot, not in the
  // hot path).
  const lines = content.split('\n')
  let count = 0
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/eslint-disable-next-line[^\n]*no-require-imports/.test(lines[i])) {
      continue
    }
    // Look at the next non-empty line for the require call.
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    const next = lines[j] ?? ''
    if (/require\s*\(\s*['"]@claude-code\//.test(next)) {
      count++
    }
  }
  return count
}

function countUnknownSlots(content: string): number {
  // Count `let _<name>: unknown = ...` declarations — setter slots whose
  // return type the file gave up on.
  const matches = content.match(/^let\s+_[a-zA-Z][\w]*:\s*unknown\b/gm)
  return matches?.length ?? 0
}

const args = process.argv.slice(2)
const tighten = args.includes('--tighten')

const content = readFileSync(DEPS_FILE, 'utf8')
const lazyRequires = countLazyRequires(content)
const unknownSlots = countUnknownSlots(content)

if (tighten) {
  const next: Baseline = { lazyRequires, unknownSlots }
  writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + '\n')
  console.log(`baseline tightened: ${JSON.stringify(next)}`)
  process.exit(0)
}

const baseline = loadBaseline()
const violations: string[] = []

if (lazyRequires > baseline.lazyRequires) {
  violations.push(
    `lazy-require count grew: current=${lazyRequires}, baseline=${baseline.lazyRequires}. Each lazy-require in _deps.ts is a runtime workaround for a static-import cycle. To add a new one, prefer moving the called function down into config (see docs/lazy-require-pattern.md and the 2026-04-29 cycle-break commit series).`,
  )
}
if (unknownSlots > baseline.unknownSlots) {
  violations.push(
    `unknown-typed setter slot count grew: current=${unknownSlots}, baseline=${baseline.unknownSlots}. Each \`let _x: unknown\` slot loses type-safety at the boundary. Give it a real type (move the type to a leaf package if needed).`,
  )
}

if (violations.length > 0) {
  console.error('verify-deps-quality: violations')
  for (const v of violations) console.error(`  ${v}`)
  console.error(
    `\nTighten with: bun run scripts/verify-deps-quality.ts --tighten`,
  )
  process.exit(1)
}

console.log(
  `verify-deps-quality: lazy-requires=${lazyRequires} (baseline ${baseline.lazyRequires}), unknown-slots=${unknownSlots} (baseline ${baseline.unknownSlots})`,
)
