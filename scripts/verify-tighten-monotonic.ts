#!/usr/bin/env bun
/**
 * verify-tighten-monotonic — meta-verifier for `--tighten` one-wayness.
 *
 * Every ratchet in this repo lives or dies by the same contract: counts
 * may shrink, never grow. That contract is enforced on the verifier's
 * READ path, but the WRITE path (`--tighten`) has historically been
 * implemented with a one-line `writeFileSync(baseline, current)` that
 * silently launders regressions: a grandfathered metric grows past its
 * baseline, an operator runs `--tighten`, and the new (higher) number
 * becomes the baseline. The bug only surfaces months later when someone
 * eyeballs the diff (this is exactly how 739c83e1 caught
 * yoloClassifier 1497 → 1509 masquerading as a tighten).
 *
 * This meta-verifier locks the contract by simulation:
 *
 *   1. Snapshot the on-disk baseline (call it S).
 *   2. Write a STRICTER version (every numeric leaf - 1, floored at 0)
 *      to disk — this simulates "an earlier tighten reduced the baseline".
 *   3. Run the verifier with `--tighten`. The codebase has not changed,
 *      so the verifier's measured `current` is ≈ S.
 *   4. Read the post-tighten baseline. For each numeric leaf:
 *        post ≤ stricter   → tighten respected one-wayness ✓
 *        post >  stricter   → tighten LOOSENED the stricter prior ✗
 *      A correct verifier implementing `min(current, prior)` will
 *      compute min(≈S, S-1) = S-1 and match `stricter`. A broken
 *      verifier blindly snapshotting `current` will write ≈S, which
 *      exceeds the S-1 we put on disk → caught.
 *   5. ALWAYS restore the snapshot exactly (try/finally), byte-for-byte.
 *
 * Why this exists: a verifier that lies about its own monotonicity is
 * worse than no verifier — it reports green while accepting regressions.
 * Discovered post-739c83e1 sweep: 8 of 11 ratchets had this bug.
 *
 * Adding a new ratchet: register the (script, baselinePath) pair in
 * RATCHETS below. The check is structure-agnostic (handles single value,
 * flat map, nested map) — any JSON-serialisable baseline whose semantics
 * are "smaller is better" works without per-verifier code.
 *
 * Excluded ratchets:
 *   - verify-ratchet.ts: multi-metric burn-in tool with separate
 *     `--burn-in` mode; its `--tighten` semantics are intentionally
 *     "re-snapshot all current values" because the metrics being
 *     measured (V7 migration counters) are themselves designed to drop
 *     to zero monotonically — there's no grandfathering to protect.
 *     If a metric grows, the verifier's READ path catches it before
 *     anyone reaches `--tighten`.
 *   - verify-tsc-errors.ts / verify-no-cycles.ts: baselines are inline
 *     constants, not JSON files; they have no `--tighten` write path.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = resolve(import.meta.dirname, '..')

interface RatchetEntry {
  /** Path to the verifier script, repo-relative */
  script: string
  /** Path to the JSON baseline file, repo-relative */
  baseline: string
  /**
   * How long to allow the verifier's `--tighten` run before considering
   * it hung. Most are <2s; silent-failure and knip are slower because
   * they spawn child audits / run knip itself.
   */
  timeoutMs?: number
}

const RATCHETS: RatchetEntry[] = [
  { script: 'scripts/verify-file-size.ts',                 baseline: 'scripts/file-size-baseline.json' },
  { script: 'scripts/verify-as-any-ratchet.ts',            baseline: 'scripts/as-any-baseline.json' },
  { script: 'scripts/verify-as-never-ratchet.ts',          baseline: 'scripts/as-never-baseline.json' },
  { script: 'scripts/verify-no-sync-fs-in-render.ts',      baseline: 'scripts/sync-fs-render-baseline.json' },
  { script: 'scripts/verify-stale-todo-comments.ts',       baseline: 'scripts/todo-baseline.json' },
  { script: 'scripts/verify-console-log-leak.ts',          baseline: 'scripts/console-log-baseline.json' },
  { script: 'scripts/verify-deps-quality.ts',              baseline: 'scripts/deps-quality-baseline.json' },
  { script: 'scripts/verify-exports-budget.ts',            baseline: 'scripts/exports-budget-baseline.json' },
  { script: 'scripts/verify-knip-headroom.ts',             baseline: 'scripts/knip-baseline.json',                   timeoutMs: 90_000 },
  { script: 'scripts/verify-silent-failure-ratchet.ts',    baseline: 'scripts/silent-failure-ratchet-baseline.json', timeoutMs: 120_000 },
]

/**
 * Walk every numeric leaf in a JSON value and apply `transform`. Returns
 * a new value of the same shape — never mutates the original. Strings,
 * booleans, nulls pass through unchanged.
 */
function mapNumberLeaves(value: unknown, transform: (n: number) => number): unknown {
  if (typeof value === 'number') return transform(value)
  if (Array.isArray(value)) return value.map(v => mapNumberLeaves(v, transform))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = mapNumberLeaves(v, transform)
    }
    return out
  }
  return value
}

/**
 * Compare numeric leaves in `expected` vs `actual`. Only flags violations
 * when BOTH sides have a number at the same path — keys present on one
 * side only are skipped because the verifier may legitimately add/drop
 * baseline entries during --tighten (e.g. file-size drops files that
 * shrunk under SOFT_THRESHOLD, knip prunes vanished package paths).
 *
 * `cmp` returns a violation message (or null for OK) given the two
 * numeric values. The path string is just for human-readable reporting.
 */
function compareLeaves(
  expected: unknown,
  actual: unknown,
  cmp: (expectedVal: number, actualVal: number) => string | null,
  path = '',
): string[] {
  const out: string[] = []
  if (typeof expected === 'number' && typeof actual === 'number') {
    const msg = cmp(expected, actual)
    if (msg !== null) out.push(`${path || '<root>'}: ${msg}`)
    return out
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const len = Math.min(expected.length, actual.length)
    for (let i = 0; i < len; i++) {
      out.push(...compareLeaves(expected[i], actual[i], cmp, `${path}[${i}]`))
    }
    return out
  }
  if (
    expected !== null && typeof expected === 'object' &&
    actual !== null && typeof actual === 'object' &&
    !Array.isArray(expected) && !Array.isArray(actual)
  ) {
    const e = expected as Record<string, unknown>
    const a = actual as Record<string, unknown>
    // Only intersect — a key present on one side only isn't a monotonic
    // violation, just a structural change in the baseline schema.
    for (const k of Object.keys(e)) {
      if (k in a) {
        const sub = path ? `${path}.${k}` : k
        out.push(...compareLeaves(e[k], a[k], cmp, sub))
      }
    }
    return out
  }
  // Mismatched shape between expected and actual at this path — skip.
  // (Pure structural drift; not the bug class this verifier targets.)
  return out
}

interface CheckResult {
  ratchet: RatchetEntry
  status: 'pass' | 'fail' | 'error'
  violations: string[]
  durationMs: number
  detail?: string
}

/**
 * Mutate baseline → run --tighten → compare → ALWAYS restore. The restore
 * runs even if the verifier subprocess crashes; the snapshot is the
 * literal pre-test bytes so byte-identity is preserved (formatting,
 * trailing newline, key order).
 */
function checkOne(entry: RatchetEntry): CheckResult {
  const baselineAbs = join(REPO_ROOT, entry.baseline)
  const scriptAbs = join(REPO_ROOT, entry.script)
  const started = performance.now()

  let originalBytes: Buffer
  try {
    originalBytes = readFileSync(baselineAbs)
  } catch (e) {
    return {
      ratchet: entry,
      status: 'error',
      violations: [`baseline not readable: ${(e as Error).message}`],
      durationMs: performance.now() - started,
    }
  }

  let snapshot: unknown
  try {
    snapshot = JSON.parse(originalBytes.toString('utf8'))
  } catch (e) {
    return {
      ratchet: entry,
      status: 'error',
      violations: [`baseline not valid JSON: ${(e as Error).message}`],
      durationMs: performance.now() - started,
    }
  }

  // Set every numeric leaf to 0. This simulates "an earlier tighten
  // reduced the baseline to zero" and is the most aggressive prior a
  // correct `min(current, prior)` verifier can be asked to preserve.
  //
  // Why 0 specifically: if current >= 0 always (it's a count), then
  //   correct  → min(current, 0) = 0      → post = 0 ≤ stricter ✓
  //   broken   → write current            → post > 0 = stricter   ✗
  // This is the only kick that reliably distinguishes correct from
  // broken regardless of whether `current` happens to coincide with
  // (baseline - 1) or any other intermediate value.
  //
  // Edge case: if a leaf was already 0, both correct and broken write
  // 0 (current is also a count ≥ 0, and if current matched 0, both are
  // indistinguishable on this leaf). That's vacuously fine — both
  // implementations are monotonic at that point.
  const stricter = mapNumberLeaves(snapshot, () => 0)

  // If snapshot was all zeros, the test is vacuously true on every leaf
  // — no broken/correct distinction is possible. Skip cleanly.
  if (JSON.stringify(stricter) === JSON.stringify(snapshot)) {
    return {
      ratchet: entry,
      status: 'pass',
      violations: [],
      durationMs: performance.now() - started,
      detail: 'all baseline leaves are 0; monotonicity vacuously holds',
    }
  }

  try {
    writeFileSync(
      baselineAbs,
      JSON.stringify(stricter, null, 2) + '\n',
    )

    const result = spawnSync('bun', [scriptAbs, '--tighten'], {
      cwd: REPO_ROOT,
      timeout: entry.timeoutMs ?? 30_000,
      encoding: 'utf8',
    })

    if (result.status !== 0) {
      return {
        ratchet: entry,
        status: 'error',
        violations: [
          `--tighten exited non-zero (code=${result.status}, signal=${result.signal ?? 'none'})`,
        ],
        durationMs: performance.now() - started,
        detail: (result.stderr ?? '').trim() || (result.stdout ?? '').trim(),
      }
    }

    let post: unknown
    try {
      post = JSON.parse(readFileSync(baselineAbs, 'utf8'))
    } catch (e) {
      return {
        ratchet: entry,
        status: 'error',
        violations: [`post-tighten baseline not valid JSON: ${(e as Error).message}`],
        durationMs: performance.now() - started,
      }
    }

    // Contract: post ≤ stricter at every shared numeric leaf. A correct
    // `min(current, prior)` implementation gives min(current, stricter)
    // ≤ stricter. A broken `write current` implementation overwrites
    // stricter with current ≈ snapshot, which is > stricter at any
    // leaf where snapshot > 0 → caught.
    const violations = compareLeaves(stricter, post, (expectedVal, actualVal) => {
      if (actualVal > expectedVal) {
        return `loosened ${expectedVal} → ${actualVal}. --tighten must be one-way down (got current; should have kept stricter prior).`
      }
      return null
    })

    return {
      ratchet: entry,
      status: violations.length === 0 ? 'pass' : 'fail',
      violations,
      durationMs: performance.now() - started,
    }
  } finally {
    // Always restore the original bytes — meta-verifier must never leave
    // baselines mutated. We use the literal Buffer (not a re-stringified
    // object) so formatting and key order survive byte-identical.
    try {
      writeFileSync(baselineAbs, originalBytes)
    } catch (e) {
      // The restore failed — surface this loudly. The operator now has a
      // dirty working tree they need to revert manually.
      console.error(
        `verify-tighten-monotonic: FATAL — could not restore ${entry.baseline}: ${(e as Error).message}`,
      )
      console.error(`  recover with: git checkout -- ${entry.baseline}`)
    }
  }
}

async function main(): Promise<void> {
  const onlyArg = process.argv.find(a => a.startsWith('--only='))
  const only = onlyArg ? onlyArg.slice('--only='.length) : null

  const targets = only
    ? RATCHETS.filter(r => r.script.includes(only) || r.baseline.includes(only))
    : RATCHETS

  if (targets.length === 0) {
    console.error(`verify-tighten-monotonic: --only=${only} matched nothing`)
    process.exit(2)
  }

  const results: CheckResult[] = []
  for (const entry of targets) {
    process.stderr.write(`  checking ${entry.script}... `)
    const r = checkOne(entry)
    results.push(r)
    process.stderr.write(`${r.status} (${Math.round(r.durationMs)}ms)\n`)
  }

  const failed = results.filter(r => r.status !== 'pass')
  if (failed.length === 0) {
    console.log(
      `verify-tighten-monotonic: ${results.length} ratchet(s) honored --tighten one-wayness`,
    )
    return
  }

  console.error('')
  console.error('verify-tighten-monotonic: violations')
  for (const r of failed) {
    console.error(`  ${r.ratchet.script}: ${r.status}`)
    for (const v of r.violations.slice(0, 5)) {
      console.error(`    - ${v}`)
    }
    if (r.violations.length > 5) {
      console.error(`    ...${r.violations.length - 5} more`)
    }
    if (r.detail) {
      const head = r.detail.split('\n').slice(0, 3).join('\n      ')
      console.error(`    detail: ${head}`)
    }
  }
  console.error('')
  console.error('Why this fails:')
  console.error('  A ratchet whose --tighten path blindly snapshots `current` will')
  console.error('  happily overwrite a stricter prior baseline with a looser current')
  console.error('  measurement, accepting a regression as the new baseline.')
  console.error('  Fix: replace `writeFileSync(BASELINE, current)` with a per-leaf')
  console.error('  `Math.min(current, prior)`. See scripts/verify-file-size.ts (commit')
  console.error('  739c83e1) for the canonical fix shape.')

  process.exit(1)
}

await main()
