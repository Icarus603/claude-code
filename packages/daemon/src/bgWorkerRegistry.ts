/**
 * Bg-job worker registry — daemon-side state.
 *
 * Mirrors ant 4706.js's per-worker `vm` instances, but trimmed:
 * ccb's daemon supervises the same things ant's does (PTY-host
 * subprocess, attacher list, heartbeat polling, retry budget) but
 * uses ccb's existing on-disk schema (`~/.claude/jobs/<short>/meta.json`)
 * for persistence, and skips the GrowthBook / telemetry / Datadog
 * paths that don't apply to ccb.
 *
 * @dynamicRequire
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { isPidAlive } from '@claude-code/shell/genericProcessUtils.js'
export { isPidAlive }

/**
 * Worker state machine. Mirrors ant RW3 transitions (4706.js:70-83):
 *
 *   spawning ⇄ running    (initial path; respawn cycles return here)
 *   running   → upgrading (binary upgraded mid-flight)
 *   running   → retiring  (graceful shutdown OR force kill)
 *   upgrading → spawning  (restart from attempt=0)
 *   retiring  → retired   (terminal)
 *
 * Retiring carries a `reason`: 'grace' (wait for idle), 'reap' (force
 * kill now), 'stop' (detach without waiting; record exited externally).
 */
export type WorkerPhase =
  | { kind: 'spawning'; attempt: number }
  | { kind: 'running' }
  | { kind: 'upgrading' }
  | {
      kind: 'retiring'
      reason: 'grace' | 'reap' | 'stop'
    }
  | { kind: 'retired'; outcome: 'done' | 'crashed' | 'killed' }

/** Persisted job record. Matches ccb's existing meta.json shape. */
export interface WorkerRecord {
  short: string
  pid: number
  cmd: readonly string[]
  cwd: string
  startedAt: number
  status: 'running' | 'exited' | 'stopped' | 'killed' | 'failed' | 'unknown'
  killedAt?: number
  exitedAt?: number
  exitCode?: number
  /**
   * Human-readable reason explaining a non-natural terminal status —
   * adoption failure ("process gone while supervisor was down", ant
   * 5166 UB8), respawn exhaustion, etc. Surfaced by `ccb ps` so the
   * user sees WHY a job ended terminally.
   */
  failedReason?: string
  mode?: 'detached' | 'pty'
  ptySocket?: string
  /** procStart timestamp from /proc/<pid>/stat or ps fallback. */
  procStart?: number
  /** Number of respawn attempts so far. Capped at 20. */
  attempt?: number
  /** Consecutive crashes within 5s of spawn. >=3 → settle 'crashed'. */
  fastCrashStreak?: number
  /** ccb version that spawned this worker; used by adopt to detect upgrade. */
  cliVersion?: string
  /** Count of attach-stall-triggered respawns. ant 5164.js wF3:23. */
  attachStallRespawns?: number
}

/** Cap on respawn attempts (ant hXK = 20). */
export const MAX_RESPAWN_ATTEMPTS = 20
/** Backoff before retrying a crashed worker (ant GW3 = 10000). */
export const RESPAWN_BACKOFF_MS = 10_000
/** Threshold for "fast crash" classification (ant SXK = 5000). */
export const FAST_CRASH_WINDOW_MS = 5_000
/** After 3 fast crashes in a row, settle the worker. */
export const FAST_CRASH_LIMIT = 3
/** Heartbeat poll interval (ant CXK = 5000). */
export const HEARTBEAT_POLL_MS = 5_000
/** Max silence before logging "stalled" (ant ZW3 = 120000). */
export const STALLED_THRESHOLD_MS = 120_000

function getJobsRoot(): string {
  const root = process.env.CLAUDE_CONFIG_HOME
  return root ? resolve(root, 'jobs') : join(homedir(), '.claude', 'jobs')
}

function getJobDir(short: string): string {
  return join(getJobsRoot(), short)
}

/** Read a meta.json into a WorkerRecord. Returns null on missing/corrupt. */
export function readWorkerRecord(short: string): WorkerRecord | null {
  const path = join(getJobDir(short), 'meta.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as WorkerRecord
  } catch {
    return null
  }
}

/** Persist a record back to meta.json. */
export function writeWorkerRecord(record: WorkerRecord): void {
  const dir = getJobDir(record.short)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(record, null, 2) + '\n')
}

/** Scan jobs/ directory and read all records. Skip unparseable. */
export function readAllWorkerRecords(): WorkerRecord[] {
  const root = getJobsRoot()
  if (!existsSync(root)) return []
  const out: WorkerRecord[] = []
  for (const short of readdirSync(root)) {
    const r = readWorkerRecord(short)
    if (r) out.push(r)
  }
  return out
}

// (canonical impl lives in @claude-code/shell/genericProcessUtils — the
// import + re-export at the top of this file pulls it in for both
// internal use here AND for callers who import isPidAlive from
// bgWorkerRegistry.)

/**
 * Read /proc/<pid>/stat field 22 (starttime) on Linux. Falls back to
 * `ps -o lstart= -p <pid>` parsing on macOS/BSD. Returns 0 if neither
 * works (e.g. WSL with /proc unmapped). 0 means "can't verify"; the
 * caller decides whether to use the unverified-adopt path.
 *
 * Used to detect PID recycling: if `procStart` doesn't match between
 * adoption attempts, the OS has reassigned the PID to a new process.
 */
export function readProcStart(pid: number): number {
  try {
    if (process.platform === 'linux') {
      // /proc/<pid>/stat: field 22 is starttime in clock ticks since boot
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      // After comm field (which can contain spaces), fields are space-separated.
      // We need field 22 = starttime, but skip the comm parens.
      const closeParen = stat.lastIndexOf(')')
      if (closeParen < 0) return 0
      const tail = stat.slice(closeParen + 2).split(' ')
      // tail[0] = field 3 (state), tail[19] = field 22 (starttime)
      const starttime = parseInt(tail[19] ?? '0', 10)
      return Number.isFinite(starttime) ? starttime : 0
    }
    // macOS/BSD fallback: read ps lstart epoch via shell
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
    const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
    })
    if (r.status !== 0) return 0
    const lstart = (r.stdout ?? '').trim()
    if (!lstart) return 0
    const t = Date.parse(lstart)
    return Number.isFinite(t) ? t : 0
  } catch {
    return 0
  }
}

/**
 * Verify that the pid recorded in `record` is still the same process
 * we spawned. Compare procStart timestamps. Returns:
 *   'verified'   — pid alive, procStart matches → adopt
 *   'recycled'   — pid alive but procStart mismatch → settle (was reused)
 *   'dead'       — pid not alive → settle exited
 *   'unverified' — can't read procStart → adopt with caveat (poll)
 */
export function verifyAdoption(
  record: WorkerRecord,
): 'verified' | 'recycled' | 'dead' | 'unverified' {
  if (!isPidAlive(record.pid)) return 'dead'
  const current = readProcStart(record.pid)
  if (current === 0) return 'unverified'
  if (record.procStart === undefined) {
    // We've never recorded procStart for this worker. Trust the live
    // pid, but capture procStart now so future verifies can compare.
    return 'verified'
  }
  return current === record.procStart ? 'verified' : 'recycled'
}

/**
 * Reconcile a record's status against live process state. Used by
 * `list` to surface accurate status without a daemon round-trip.
 */
export function reconcileWorkerRecord(record: WorkerRecord): WorkerRecord {
  if (record.status !== 'running') return record
  const v = verifyAdoption(record)
  if (v === 'verified' || v === 'unverified') return record
  // Dead OR pid recycled → mark exited.
  const updated: WorkerRecord = {
    ...record,
    status: 'exited',
    exitedAt: Date.now(),
  }
  try {
    writeWorkerRecord(updated)
  } catch {
    // Best-effort; daemon may not have write access if uid changed.
  }
  return updated
}
