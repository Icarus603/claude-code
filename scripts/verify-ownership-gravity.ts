#!/usr/bin/env bun
/**
 * verify-ownership-gravity.ts — L1 check for V7 §3.1 "Owner Over Shim".
 *
 * Existing verifiers only check that root facades are `export *` re-exports,
 * which lets a package pass as "owner" while its real implementation still
 * lives in `src/`. This verifier measures the actual center of gravity:
 *
 *   gravity_ratio = owner_lines / (owner_lines + src_mirror_lines)
 *
 * where
 *   - `owner_lines` = non-skeleton TS/TSX LOC inside the owner package
 *   - `src_mirror_lines` = LOC in the root `src/*` paths that V7 §10 says
 *     should eventually drain into this package
 *
 * A package fails this check if:
 *   - its src_mirror still contains more implementation than the package
 *     itself (gravity_ratio < wave threshold), OR
 *   - it is registered in SUBSYSTEM_MIRRORS but provides < MIN_OWNER_LINES
 *     of non-skeleton code (prevents "empty shell" regressions)
 *
 * Skeleton exclusions: contracts.ts, errors.ts, index.ts re-exports,
 * testing/*, types/*, contracts/* directories. See `isSkeletonFile`.
 *
 * Registers into doctor-architecture.ts under "Cross-Cutting" layer.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, sep } from 'path'

// The subsystem → src-mirror mapping is maintained in a sibling file so it
// can be reviewed as a standalone artifact during V7 audits. See
// `ownership-gravity-map.ts` for derivation from V7 §8 / §10.
import { SUBSYSTEM_MIRRORS } from './ownership-gravity-map.js'

// --- Wave-gated thresholds -------------------------------------------------
// Later waves get stricter thresholds. A package in wave N cannot advance
// to wave N+1 until its gravity_ratio exceeds the wave-N threshold.
const WAVE_THRESHOLDS: Record<number, number> = {
  0: 0.0,  // prep only — no gravity required
  1: 0.5,  // leaves: owner should hold half
  2: 0.6,  // platform foundations
  3: 0.7,  // domain core (provider / tool-registry / command-runtime)
  4: 0.8,  // agent hub
  5: 0.85, // integrations
  6: 0.9,  // app hosts — near-complete migration
}

// Minimum absolute owner lines for any registered subsystem. Catches the
// "14-line shell" failure mode where gravity ratio is undefined because
// both sides are empty.
const MIN_OWNER_LINES = 200

// --- File classification ---------------------------------------------------

const SKELETON_BASENAMES = new Set([
  'contracts.ts',
  'errors.ts',
  'index.ts',
])

const SKELETON_DIR_SEGMENTS = new Set([
  'contracts',
  'testing',
  'types',
  '__tests__',
  '__mocks__',
])

function isSkeletonFile(path: string): boolean {
  const segments = path.split(sep)
  const basename = segments[segments.length - 1] ?? ''
  if (SKELETON_BASENAMES.has(basename)) return true
  if (basename.endsWith('.d.ts')) return true
  if (basename.endsWith('.test.ts') || basename.endsWith('.test.tsx')) return true
  for (const seg of segments) {
    if (SKELETON_DIR_SEGMENTS.has(seg)) return true
  }
  return false
}

async function walkTsFiles(root: string, exclude: Set<string> = new Set()): Promise<string[]> {
  // If `root` is a file, return it as a single entry (srcMirrors may list
  // individual files like src/context.ts as well as directories).
  let rootStat
  try { rootStat = await stat(root) } catch { return [] }
  if (rootStat.isFile()) {
    return /\.(ts|tsx)$/.test(root) && !exclude.has(root) ? [root] : []
  }

  let out: string[] = []
  let entries: string[] = []
  try {
    entries = await readdir(root)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.turbo') continue
    const full = join(root, name)
    if (exclude.has(full)) continue
    let s
    try { s = await stat(full) } catch { continue }
    if (s.isDirectory()) {
      out = out.concat(await walkTsFiles(full, exclude))
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Build a per-entry exclusion set: every path claimed by another entry that
 * is nested inside one of my mirrors. Prevents double-counting when a parent
 * dir (e.g. src/components) is claimed by repl and a child (e.g.
 * src/components/permissions) is claimed by permission.
 */
function buildExclusionSet(entry: SubsystemMirror, all: SubsystemMirror[]): Set<string> {
  const exclude = new Set<string>()
  for (const mine of entry.srcMirrors) {
    for (const other of all) {
      if (other === entry) continue
      for (const theirs of other.srcMirrors) {
        // theirs is nested inside mine → must be excluded from my walk
        if (theirs === mine) continue
        if (theirs.startsWith(mine + sep) || theirs.startsWith(mine + '/')) {
          exclude.add(theirs)
        }
      }
    }
  }
  return exclude
}

type SubsystemMirror = typeof SUBSYSTEM_MIRRORS[number]

async function countLines(files: string[], skipSkeleton: boolean): Promise<number> {
  let total = 0
  for (const file of files) {
    if (skipSkeleton && isSkeletonFile(file)) continue
    const content = await readFile(file, 'utf8')
    // Count non-blank, non-comment-only lines as a rough proxy for implementation weight.
    for (const raw of content.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      if (line.startsWith('//')) continue
      if (line.startsWith('*') || line.startsWith('/*') || line === '*/') continue
      total++
    }
  }
  return total
}

// --- Main ------------------------------------------------------------------

type SubsystemViolation = {
  subsystem: string
  reason: string
  ownerLines: number
  mirrorLines: number
  ratio: number
  threshold: number
  wave: number
}

type EntryMetrics = {
  entry: SubsystemMirror
  ownerLines: number
  mirrorLines: number
  ratio: number
  threshold: number
}

async function measure(entry: SubsystemMirror): Promise<EntryMetrics> {
  const ownerFiles = await walkTsFiles(entry.ownerPackage)
  const ownerLines = await countLines(ownerFiles, /*skipSkeleton*/ true)

  const exclude = buildExclusionSet(entry, SUBSYSTEM_MIRRORS)
  let mirrorLines = 0
  for (const m of entry.srcMirrors) {
    const files = await walkTsFiles(m, exclude)
    mirrorLines += await countLines(files, /*skipSkeleton*/ false)
  }

  const threshold = entry.threshold ?? WAVE_THRESHOLDS[entry.wave] ?? 0.7
  const ratio = ownerLines + mirrorLines === 0
    ? 0
    : ownerLines / (ownerLines + mirrorLines)

  return { entry, ownerLines, mirrorLines, ratio, threshold }
}

function classify(m: EntryMetrics): SubsystemViolation | null {
  if (m.ownerLines < MIN_OWNER_LINES) {
    return {
      subsystem: m.entry.subsystem,
      reason: `empty-shell: owner has ${m.ownerLines} LOC (min ${MIN_OWNER_LINES})`,
      ownerLines: m.ownerLines, mirrorLines: m.mirrorLines, ratio: m.ratio,
      threshold: m.threshold, wave: m.entry.wave,
    }
  }
  if (m.ratio < m.threshold) {
    return {
      subsystem: m.entry.subsystem,
      reason: `gravity-ratio ${m.ratio.toFixed(2)} < wave-${m.entry.wave} threshold ${m.threshold}`,
      ownerLines: m.ownerLines, mirrorLines: m.mirrorLines, ratio: m.ratio,
      threshold: m.threshold, wave: m.entry.wave,
    }
  }
  return null
}

async function main(): Promise<void> {
  const measurements = await Promise.all(SUBSYSTEM_MIRRORS.map(measure))
  const violations = measurements
    .map(classify)
    .filter((v): v is SubsystemViolation => v !== null)

  // Always print the full table so migration progress is visible in CI logs.
  // Group by wave for readability.
  console.log('ownership gravity report (owner / mirror / ratio):')
  const byWave = new Map<number, EntryMetrics[]>()
  for (const m of measurements) {
    const list = byWave.get(m.entry.wave) ?? []
    list.push(m)
    byWave.set(m.entry.wave, list)
  }
  for (const wave of [...byWave.keys()].sort((a, b) => a - b)) {
    console.log(`  -- Wave ${wave} --`)
    for (const m of byWave.get(wave)!) {
      const status = classify(m) ? '✗' : '✓'
      console.log(
        `    ${status} ${m.entry.subsystem.padEnd(20)} owner=${String(m.ownerLines).padStart(6)} mirror=${String(m.mirrorLines).padStart(6)} ratio=${m.ratio.toFixed(2)} (thr ${m.threshold})`,
      )
    }
  }

  if (violations.length > 0) {
    console.error('\nownership gravity violations:')
    for (const v of violations) {
      console.error(`  [${v.subsystem}] ${v.reason}`)
    }
    throw new Error(`${violations.length} subsystems failed ownership gravity check`)
  }

  console.log('\nownership gravity verification passed')
}

await main()
