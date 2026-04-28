#!/usr/bin/env bun
/**
 * verify-silent-failure-ratchet — baseline-lock the audit findings whose
 * count cannot realistically reach 0 today.
 *
 * Each pattern has a baseline number in
 * `scripts/silent-failure-ratchet-baseline.json`. Counts may shrink, never
 * grow. This stops V7-class regressions that don't fit the binary
 * verifier model:
 *   - empty-catch: 99 LOW occurrences, mostly intentional swallows.
 *   - nullish-coalesce-critical-path: 345, many designed defaults.
 *   - stub-return-only: 26 placeholders.
 *   - always-false-feature-flag: 495 conditional dead branches.
 *   - type-cast-trap: 563 (mostly decompiled boilerplate).
 *   - require-fallback-to-stub: 272 (V7 dynamic-import gates).
 *
 * Tighten with:
 *   bun scripts/verify-silent-failure-ratchet.ts --tighten
 * after eliminating findings.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const BASELINE = join(REPO_ROOT, 'scripts/silent-failure-ratchet-baseline.json')

const AUDITS = {
  'empty-catch': '05-empty-catch.ts',
  'nullish-coalesce-critical-path': '06-nullish-coalesce-critical-path.ts',
  'stub-return-only': '07-stub-return-only.ts',
  'always-false-feature-flag': '08-always-false-feature-flags.ts',
  'type-cast-trap': '10-type-cast-traps.ts',
  'require-fallback-to-stub': '11-require-fallback.ts',
} as const

interface AuditOutput {
  pattern: string
  findings: Array<unknown>
}

function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [name, file] of Object.entries(AUDITS)) {
    const stdout = execSync(
      `bun ${join(REPO_ROOT, 'scripts/audit-silent-failures', file)}`,
      { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 },
    )
    const result = JSON.parse(stdout) as AuditOutput
    counts[name] = result.findings.length
  }
  return counts
}

async function main(): Promise<void> {
  const tighten = process.argv.includes('--tighten')
  let baseline: Record<string, number> = {}
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {}

  const current = currentCounts()

  if (tighten) {
    const next: Record<string, number> = {}
    for (const [k, v] of Object.entries(current)) {
      const prev = baseline[k]
      next[k] = prev !== undefined && prev < v ? prev : v
    }
    writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n')
    console.log('silent-failure-ratchet-baseline.json updated')
    return
  }

  const violations: string[] = []
  for (const [name, count] of Object.entries(current)) {
    const max = baseline[name]
    if (max === undefined) {
      violations.push(`${name}: not in baseline (count=${count})`)
      continue
    }
    if (count > max) {
      violations.push(
        `${name}: ${count} (budget ${max}). One-way ratchet — counts may shrink, never grow. ` +
          `Look at the audit output and decide if this is a real regression.`,
      )
    }
  }
  for (const k of Object.keys(baseline)) {
    if (!(k in current)) {
      violations.push(`${k}: baseline entry exists but pattern not produced (run --tighten)`)
    }
  }

  if (violations.length > 0) {
    console.error('verify-silent-failure-ratchet: violations')
    for (const v of violations) console.error(`  - ${v}`)
    throw new Error(`${violations.length} silent-failure ratchets regressed`)
  }
  const total = Object.values(current).reduce((a, b) => a + b, 0)
  const ratch = Object.values(baseline).reduce((a, b) => a + b, 0)
  console.log(
    `verify-silent-failure-ratchet: ${total} findings (baseline ${ratch}, all within budget)`,
  )
}

await main()
