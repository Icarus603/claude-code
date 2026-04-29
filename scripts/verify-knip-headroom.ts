#!/usr/bin/env bun
/**
 * verify-knip-headroom — knip unused-files + unused-exports ratchet.
 *
 * Two monotonically-shrink-only counts:
 *   - unusedFiles: files knip can't trace from any entrypoint (scoped to packages/)
 *   - unusedExports: declared exports knip can't find a consumer for
 *
 * Tighten with `--tighten` after a real reduction. Without ratcheting,
 * future commits can re-add dead shims and dead re-exports without anyone
 * noticing.
 *
 * Why this matters: V7-era forward shims accumulated to ~190 unused files
 * and ~200 unused exports. Iteration 2 of the V8 cleanup pulled the easy
 * wins (~17 files); this verifier locks the gain so iteration 3 can build
 * on it without backsliding.
 */
import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const BASELINE_FILE = join(REPO_ROOT, 'scripts/knip-baseline.json')

interface Baseline {
  unusedFiles: number
  unusedExports: number
}

function loadBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  } catch {
    return { unusedFiles: Infinity, unusedExports: Infinity }
  }
}

function getKnipCounts(): Baseline {
  let out = ''
  try {
    out = execSync('bunx knip --reporter json 2>/dev/null', {
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024,
    })
  } catch (e) {
    const err = e as { stdout?: Buffer | string }
    out = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString() ?? ''
  }
  const report = JSON.parse(out) as {
    issues: Array<{
      files?: Array<{ name: string }>
      exports?: Array<{ name: string }>
    }>
  }
  const filesSet = new Set<string>()
  let exportsCount = 0
  for (const issue of report.issues) {
    for (const f of issue.files ?? []) {
      // Only count packages/ — top-level scripts are off-domain.
      if (f.name.startsWith('packages/')) filesSet.add(f.name)
    }
    exportsCount += (issue.exports ?? []).length
  }
  return { unusedFiles: filesSet.size, unusedExports: exportsCount }
}

const args = process.argv.slice(2)
const tighten = args.includes('--tighten')

const current = getKnipCounts()

if (tighten) {
  writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2) + '\n')
  console.log(`baseline tightened: ${JSON.stringify(current)}`)
  process.exit(0)
}

const baseline = loadBaseline()
const violations: string[] = []

if (current.unusedFiles > baseline.unusedFiles) {
  violations.push(
    `unused-file count grew: current=${current.unusedFiles}, baseline=${baseline.unusedFiles}. New dead shim or orphan introduced. Either delete the new file or update the baseline with --tighten if the growth is intentional (e.g., new feature scaffolding).`,
  )
}
if (current.unusedExports > baseline.unusedExports) {
  violations.push(
    `unused-export count grew: current=${current.unusedExports}, baseline=${baseline.unusedExports}. A re-export was added that nothing consumes. Drop the export or add a real caller.`,
  )
}

if (violations.length > 0) {
  console.error('verify-knip-headroom: violations')
  for (const v of violations) console.error(`  ${v}`)
  console.error(
    `\nTighten with: bun run scripts/verify-knip-headroom.ts --tighten`,
  )
  process.exit(1)
}

console.log(
  `verify-knip-headroom: unused-files=${current.unusedFiles} (baseline ${baseline.unusedFiles}), unused-exports=${current.unusedExports} (baseline ${baseline.unusedExports})`,
)
