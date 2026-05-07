/**
 * Daemon-wide worker roster — `~/.claude/daemon/roster.json`.
 *
 * ant 4139.js (`_e`/`wm`/`MlH`/`d_3`/`RV8`) — a single JSON file with a
 * snapshot of every live worker keyed by short id. Survives daemon
 * restart so the new daemon instance can adopt orphaned workers
 * without rescanning the entire jobs/ tree (and without missing workers
 * whose meta.json is in a different cwd-tree).
 *
 * Schema (matches ant Ii7 — 4070.js:56-63):
 *   {
 *     proto: number          // PROTO_VERSION
 *     supervisorPid: number  // current daemon pid
 *     updatedAt: number      // ms epoch of last write
 *     workers: { [short]: RosterEntry }
 *     parseFailed?: boolean  // set on read when JSON parse failed
 *   }
 *
 * RosterEntry (zs5 — 4070.js:38-55) is a stripped subset of WorkerRecord:
 *   pid, procStart, sessionId, rendezvousSock, ptySock, cliVersion,
 *   startedAt, attempt, cwd, worktreePath, dispatch, pendingRespawn.
 *
 * Concurrency: ant gates writes through a chained promise (4139.js
 * `MlH`) so concurrent updates serialize. ccb mirrors with the same
 * `writeQueue.then(...)` pattern. Last-write-wins; the supervisor pid
 * + updatedAt fields tag every write.
 *
 * Corruption handling: ant 4139.js `Ms7` renames the file to
 * `roster.json.corrupt.<ts>` so the next supervisor still gets a fresh
 * file but the bad copy is preserved for postmortem. ccb mirrors.
 *
 * @dynamicRequire
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { logEvent } from '@claude-code/local-observability'

import type { WorkerRecord } from './bgWorkerRegistry.js'
import { getDaemonHomeDir } from './socketPaths.js'
import { PROTO_VERSION } from './socketProto.js'

/**
 * Roster entry for one worker. Subset of WorkerRecord fields that
 * survive supervisor restart (pid + sockets + dispatch envelope).
 *
 * ant 4070.js zs5 names the rendezvous socket `rendezvousSock` and
 * the PTY socket `ptySock`. ccb's WorkerRecord uses `ptySocket`. We
 * carry both names so cross-version reads stay tolerant.
 */
export interface RosterEntry {
  pid: number
  procStart?: number
  sessionId?: string
  rendezvousSock?: string
  ptySock?: string
  cliVersion?: string
  startedAt: number
  attempt: number
  cwd: string
  worktreePath?: string
  dispatch?: Record<string, unknown>
  pendingRespawn?: 'upgrade'
  decModes?: number[]
}

export interface Roster {
  proto: number
  supervisorPid: number
  updatedAt: number
  workers: Record<string, RosterEntry>
  parseFailed?: boolean
}

/** Path to roster.json (one global file per uid, not per repo-hash). */
export function getRosterPath(): string {
  return join(getDaemonHomeDir(), 'roster.json')
}

/** Empty roster — returned by readRoster on missing file or after corrupt-quarantine. */
export function emptyRoster(): Roster {
  return {
    proto: PROTO_VERSION,
    supervisorPid: process.pid,
    updatedAt: Date.now(),
    workers: {},
  }
}

/**
 * Project a WorkerRecord into a RosterEntry. Used by daemon when
 * persisting the live workers map back to disk after spawn / state-change.
 */
export function recordToRosterEntry(r: WorkerRecord): RosterEntry {
  return {
    pid: r.pid,
    procStart: r.procStart,
    rendezvousSock: r.ptySocket,
    ptySock: r.ptySocket,
    cliVersion: r.cliVersion,
    startedAt: r.startedAt,
    attempt: r.attempt ?? 0,
    cwd: r.cwd,
  }
}

/**
 * Validate a parsed JSON value against the Roster schema. Returns
 * the typed value, or null on shape mismatch. We avoid pulling zod
 * here so the daemon entry stays minimal-deps.
 */
function validateRoster(v: unknown): Roster | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.proto !== 'number') return null
  if (typeof o.supervisorPid !== 'number') return null
  if (typeof o.updatedAt !== 'number') return null
  if (!o.workers || typeof o.workers !== 'object') return null
  const workers: Record<string, RosterEntry> = {}
  for (const [k, raw] of Object.entries(o.workers as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') return null
    const w = raw as Record<string, unknown>
    if (typeof w.pid !== 'number') return null
    if (typeof w.startedAt !== 'number') return null
    if (typeof w.cwd !== 'string') return null
    if (typeof w.attempt !== 'number') return null
    workers[k] = {
      pid: w.pid,
      procStart: typeof w.procStart === 'number' ? w.procStart : undefined,
      sessionId: typeof w.sessionId === 'string' ? w.sessionId : undefined,
      rendezvousSock:
        typeof w.rendezvousSock === 'string' ? w.rendezvousSock : undefined,
      ptySock: typeof w.ptySock === 'string' ? w.ptySock : undefined,
      cliVersion: typeof w.cliVersion === 'string' ? w.cliVersion : undefined,
      startedAt: w.startedAt,
      attempt: w.attempt,
      cwd: w.cwd,
      worktreePath:
        typeof w.worktreePath === 'string' ? w.worktreePath : undefined,
      dispatch:
        w.dispatch && typeof w.dispatch === 'object'
          ? (w.dispatch as Record<string, unknown>)
          : undefined,
      pendingRespawn: w.pendingRespawn === 'upgrade' ? 'upgrade' : undefined,
      decModes: Array.isArray(w.decModes)
        ? (w.decModes as number[]).filter(n => typeof n === 'number')
        : undefined,
    }
  }
  return {
    proto: o.proto,
    supervisorPid: o.supervisorPid,
    updatedAt: o.updatedAt,
    workers,
  }
}

/**
 * Quarantine a corrupt roster.json — rename to .corrupt.<ts>. ant
 * 4139.js Ms7. Best effort; failures are logged but don't propagate.
 */
export async function quarantineCorruptRoster(): Promise<void> {
  const p = getRosterPath()
  try {
    await rename(p, `${p}.corrupt.${Date.now()}`)
  } catch (e) {
    logEvent('tengu_bg_roster_quarantine_failed', {
      errno: (e as NodeJS.ErrnoException).code ?? 'unknown',
    })
  }
}

/**
 * Read roster.json from disk. ant 4139.js `wm`. Returns:
 *   - empty roster on missing file (ENOENT)
 *   - empty + parseFailed:true on JSON parse error (with quarantine)
 *   - empty + parseFailed:true on schema mismatch (with quarantine)
 *
 * `silent` skips the quarantine + telemetry — used by tools that just
 * want to peek at the roster without mutating it (`ccb doctor`).
 */
export async function readRoster(opts?: { silent?: boolean }): Promise<Roster> {
  const p = getRosterPath()
  let raw: string
  try {
    raw = await readFile(p, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyRoster()
    if (!opts?.silent) {
      logEvent('tengu_bg_roster_parse_failed', {
        orphaned: '-1',
        quarantined: '1',
        errCode: (e as NodeJS.ErrnoException).code ?? 'unknown',
      })
      await quarantineCorruptRoster()
    }
    return { ...emptyRoster(), parseFailed: true }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    if (!opts?.silent) {
      const orphaned = countWorkersInRawJson(raw)
      logEvent('tengu_bg_roster_parse_failed', {
        orphaned: String(orphaned),
        quarantined: '1',
        errCode: (e as Error).name,
      })
      await quarantineCorruptRoster()
    }
    return { ...emptyRoster(), parseFailed: true }
  }
  const validated = validateRoster(parsed)
  if (validated) return validated
  if (!opts?.silent) {
    const orphaned = countWorkersInRawJson(raw)
    logEvent('tengu_bg_roster_parse_failed', {
      orphaned: String(orphaned),
      quarantined: '1',
      errCode: 'schema-mismatch',
    })
    await quarantineCorruptRoster()
  }
  return { ...emptyRoster(), parseFailed: true }
}

/**
 * Best-effort count of `workers` keys in a possibly-malformed JSON
 * blob. ant Q_3 — used to estimate how many workers we're orphaning
 * by quarantining the file. Returns 0 on any uncertainty.
 */
function countWorkersInRawJson(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as { workers?: unknown }
    const w = parsed?.workers
    if (w && typeof w === 'object' && !Array.isArray(w)) {
      return Object.keys(w).length
    }
  } catch {
    /* fall through */
  }
  return 0
}

/**
 * Atomically write roster.json. ant 4139.js d_3. Creates the daemon dir
 * with mode 0700 if missing; writes file mode 0600.
 */
export async function writeRoster(roster: Roster): Promise<void> {
  const p = getRosterPath()
  await mkdir(dirname(p), { recursive: true, mode: 0o700 })
  const tmp = `${p}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(roster, null, 2), { mode: 0o600 })
  await rename(tmp, p)
}

/**
 * Update the roster atomically through a callback. ant MlH — chains
 * pending writes through a single promise so concurrent updates
 * serialize last-write-wins. Returns the post-mutation roster.
 *
 * The mutator may either return a new Roster or mutate-in-place and
 * return undefined (matching ant's API: `K(q) ?? q`).
 */
let writeQueue: Promise<unknown> = Promise.resolve()
export function updateRoster(
  mutator: (current: Roster) => Roster | undefined | void,
): Promise<Roster> {
  const p: Promise<Roster> = writeQueue.then(async () => {
    const current = await readRoster()
    const mutated = mutator(current) as Roster | undefined
    const next: Roster = mutated ?? current
    next.supervisorPid = process.pid
    next.updatedAt = Date.now()
    await writeRoster(next)
    return next
  })
  writeQueue = p.catch(() => {})
  return p
}
