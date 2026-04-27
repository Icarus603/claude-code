#!/usr/bin/env bun
/**
 * verify-exports-budget — package.json#exports surface ratchet.
 *
 * Each owner package has a maximum number of exports entries. Decreasing
 * is fine; increasing requires a verifier-aware reason. This stops dead
 * exports from creeping back in via "just add one more entry" PRs.
 *
 * To shrink: drop the unused entry, run `bun run scripts/verify-exports-budget.ts --tighten`,
 * commit the new baseline alongside the source change.
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const BASELINE_FILE = join(REPO_ROOT, 'scripts', 'exports-budget-baseline.json')

function* walkPackages(): Generator<{ name: string; path: string }> {
  for (const root of ['packages', 'packages/@ant']) {
    const fullRoot = join(REPO_ROOT, root)
    let entries: string[] = []
    try { entries = readdirSync(fullRoot) } catch { continue }
    for (const e of entries) {
      const p = join(fullRoot, e)
      try {
        if (!statSync(p).isDirectory()) continue
        if (root === 'packages' && e === '@ant') continue
        const pkgFile = join(p, 'package.json')
        const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
        if (!pkg.name || !pkg.exports) continue
        yield { name: pkg.name, path: `${root}/${e}` }
      } catch {}
    }
  }
}

function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const c of walkPackages()) {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, c.path, 'package.json'), 'utf8'))
    counts[c.name] = Object.keys(pkg.exports).length
  }
  return counts
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const tighten = args.includes('--tighten')

  let baseline: Record<string, number> = {}
  try { baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) } catch {}

  const current = currentCounts()

  if (tighten) {
    // Tighten: write current values, but only allow keeping baseline ≥ current.
    // (existing baseline can stay if it's already ≤ current — that's a tighter rule)
    const next: Record<string, number> = {}
    for (const [k, v] of Object.entries(current)) {
      const prev = baseline[k]
      next[k] = prev !== undefined && prev < v ? prev : v
    }
    writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + '\n')
    console.log('exports-budget-baseline.json updated')
    return
  }

  const violations: string[] = []
  for (const [name, count] of Object.entries(current)) {
    const max = baseline[name]
    if (max === undefined) {
      violations.push(`${name}: not in baseline (count=${count}). Run --tighten to add.`)
      continue
    }
    if (count > max) {
      violations.push(`${name}: ${count} entries (budget ${max}). Reduce or, if intentional, justify in PR description; until then this fails.`)
    }
  }
  // Also flag stale baseline entries (package no longer exists or no longer has exports)
  for (const k of Object.keys(baseline)) {
    if (!(k in current)) {
      violations.push(`${k}: baseline entry exists but package not found (run --tighten to remove)`)
    }
  }

  if (violations.length > 0) {
    console.error('exports-budget violations:')
    for (const v of violations) console.error(`  - ${v}`)
    throw new Error(`${violations.length} violations`)
  }
  console.log('exports-budget verification passed')
}

await main()
