#!/usr/bin/env bun
/**
 * verify-file-size — file-size ratchet.
 *
 * Rules:
 *   1. NEW files (not in baseline) must be ≤ 800 LOC.
 *   2. Files in the baseline can stay or shrink, never grow past their
 *      grandfather value.
 *   3. Once a file shrinks below the soft threshold (800), it loses its
 *      grandfather status and the ≤800 rule applies.
 *
 * Tighten: `bun run scripts/verify-file-size.ts --tighten`. This locks
 * each baseline file to its current LOC. Run after a real shrink.
 *
 * Why: stops the "5641-line REPLView" pattern from being added without
 * anyone noticing.
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from 'fs'
import { join, relative, resolve } from 'path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const BASELINE_FILE = join(REPO_ROOT, 'scripts', 'file-size-baseline.json')
const SOFT_THRESHOLD = 800

const SCAN_ROOTS = ['packages']
const SCAN_EXCLUDES = new Set(['node_modules', 'dist', '__tests__', 'testing', 'vendor'])

function* walkSourceFiles(dir: string): Generator<string> {
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    if (SCAN_EXCLUDES.has(e)) continue
    const full = join(dir, e)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) yield* walkSourceFiles(full)
    else if (e.endsWith('.ts') || e.endsWith('.tsx')) yield full
  }
}

function loc(path: string): number {
  return readFileSync(path, 'utf8').split('\n').length
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const tighten = args.includes('--tighten')

  const baseline: Record<string, number> = (() => {
    try { return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) } catch { return {} }
  })()

  const current: Record<string, number> = {}
  for (const root of SCAN_ROOTS) {
    for (const f of walkSourceFiles(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, f)
      current[rel] = loc(f)
    }
  }

  if (tighten) {
    // Snapshot files >SOFT_THRESHOLD only — files ≤800 don't need grandfathering.
    const next: Record<string, number> = {}
    for (const [path, count] of Object.entries(current)) {
      if (count > SOFT_THRESHOLD) next[path] = count
    }
    writeFileSync(BASELINE_FILE, JSON.stringify(Object.fromEntries(Object.entries(next).sort()), null, 2) + '\n')
    console.log(`file-size-baseline.json updated (${Object.keys(next).length} large files)`)
    return
  }

  const violations: string[] = []

  // Rule 1+3: any file >SOFT_THRESHOLD must be in baseline AND ≤ baseline value
  for (const [path, count] of Object.entries(current)) {
    if (count <= SOFT_THRESHOLD) continue
    const max = baseline[path]
    if (max === undefined) {
      violations.push(`${path}: ${count} LOC exceeds new-file budget (${SOFT_THRESHOLD}). Decompose, or run --tighten only after the file already exists in main and is impractical to split now.`)
      continue
    }
    if (count > max) {
      violations.push(`${path}: ${count} LOC, grew past grandfathered budget ${max}. The ratchet is one-way (down).`)
    }
  }

  // Rule 2 sanity: stale baseline entries (file deleted or now ≤ threshold)
  for (const path of Object.keys(baseline)) {
    if (!(path in current)) {
      violations.push(`${path}: baseline entry exists but file not found (run --tighten to remove)`)
    }
  }

  if (violations.length > 0) {
    console.error('file-size violations:')
    for (const v of violations.slice(0, 30)) console.error(`  - ${v}`)
    if (violations.length > 30) console.error(`  ...${violations.length - 30} more`)
    throw new Error(`${violations.length} violations`)
  }
  console.log(`file-size verification passed (${Object.keys(baseline).length} grandfathered, soft threshold ${SOFT_THRESHOLD})`)
}

await main()
