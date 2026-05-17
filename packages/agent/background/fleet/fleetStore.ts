/**
 * File-based FleetView job-state I/O.
 *
 * Mirrors ant 2507.js:25-178 — the per-short-id directory under
 * `~/.claude/jobs/<short>/` containing:
 *   state.json         — primary job state (FleetJobState)
 *   order              — manual sortOrder override (decimal string)
 *   stateOrder         — manual cross-bucket order override
 *   pinned             — empty marker file when pinned (legacy migration)
 *   classifier-state.json + timeline.jsonl — owned by daemon/classifier
 *
 * The pin set is mirrored canonically at `~/.claude/jobs/pins.json` as
 * `string[]`. ant `di1()` migrates from per-job `pinned` marker files
 * on first read.
 *
 * @dynamicRequire — only used by the FleetView screen + tools that
 * mutate background-job state. NOT in the hot path of regular CLI ops.
 */

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { readEnv } from '@claude-code/config/env'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import type {
  FleetJob,
  FleetJobState,
} from './fleetTypes.js'

const STATE_FILE = 'state.json'
const ORDER_FILE = 'order'
const STATE_ORDER_FILE = 'stateOrder'
const PINNED_MARKER_FILE = 'pinned'
const PINS_FILE = 'pins.json'

/** Source: ant b0(). */
export function getJobsRoot(): string {
  const root = readEnv('CLAUDE_CONFIG_HOME')
  return root ? join(root, 'jobs') : join(homedir(), '.claude', 'jobs')
}

/** Source: ant V4(short). */
export function getJobDir(short: string): string {
  return join(getJobsRoot(), short)
}

function getPinsPath(): string {
  return join(getJobsRoot(), PINS_FILE)
}

/**
 * Per-job mtime-keyed cache (`s7` short-circuit). Cleared when size
 * exceeds 1000 entries.
 */
const stateCache = new Map<string, { mtimeKey: string; state: FleetJobState | null }>()

function isNoEnt(err: unknown): boolean {
  return (err as { code?: string })?.code === 'ENOENT'
}

/**
 * Read + parse + validate a single job's state.json. Returns the
 * parsed FleetJobState or `null` if the file is missing or malformed.
 *
 * Caches by mtime of state.json + order + stateOrder so repeat reads
 * are cheap when nothing changed.
 *
 * Source: ant s7 (2507.js:77-136).
 */
export async function readJobState(jobDir: string): Promise<FleetJobState | null> {
  const statePath = join(jobDir, STATE_FILE)
  const orderPath = join(jobDir, ORDER_FILE)
  const stateOrderPath = join(jobDir, STATE_ORDER_FILE)

  let mtimeKey: string
  try {
    const [stateStat, orderMtime, stateOrderMtime] = await Promise.all([
      fs.stat(statePath).then(s => s.mtimeMs),
      fs.stat(orderPath).then(
        s => s.mtimeMs,
        () => 0,
      ),
      fs.stat(stateOrderPath).then(
        s => s.mtimeMs,
        () => 0,
      ),
    ])
    mtimeKey = `${stateStat}:${orderMtime}:${stateOrderMtime}`
  } catch (err) {
    stateCache.delete(jobDir)
    if (!isNoEnt(err)) {
      // Best-effort warn — caller treats null as "skip job".
      logForDebugging(
        `[fleet] skipping ${basename(jobDir)}: state.json stat failed — ${err instanceof Error ? err.message : String(err)}`,
        { level: 'warn' },
      )
    }
    return null
  }

  const cached = stateCache.get(jobDir)
  if (cached !== undefined && cached.mtimeKey === mtimeKey) return cached.state

  try {
    const [stateText, orderText, stateOrderText] = await Promise.all([
      fs.readFile(statePath, 'utf-8'),
      fs.readFile(orderPath, 'utf-8').catch(() => null),
      fs.readFile(stateOrderPath, 'utf-8').catch(() => null),
    ])
    const parsed = JSON.parse(stateText) as FleetJobState
    const sortOrder = orderText !== null ? Number(orderText) : undefined
    const stateSortOrder = stateOrderText !== null ? Number(stateOrderText) : undefined
    let merged = parsed
    if (Number.isFinite(sortOrder)) merged = { ...merged, sortOrder }
    if (Number.isFinite(stateSortOrder)) merged = { ...merged, stateSortOrder }
    if (stateCache.size > 1000) stateCache.clear()
    stateCache.set(jobDir, { mtimeKey, state: merged })
    return merged
  } catch (err) {
    stateCache.delete(jobDir)
    logForDebugging(
      `[fleet] skipping ${basename(jobDir)}: state.json read/parse failed — ${err instanceof Error ? err.message : String(err)}`,
      { level: 'warn' },
    )
    return null
  }
}

/**
 * Write a full FleetJobState back to disk. Strips `pinned` / `sortOrder` /
 * `stateSortOrder` — those live in sibling files.
 *
 * Source: ant UT (2507.js:64-67).
 */
export async function writeJobState(jobDir: string, state: FleetJobState): Promise<void> {
  const {
    pinned: _pinned,
    sortOrder: _sortOrder,
    stateSortOrder: _stateSortOrder,
    ...rest
  } = state
  await fs.mkdir(jobDir, { recursive: true })
  await fs.writeFile(join(jobDir, STATE_FILE), JSON.stringify(rest, null, 2))
  invalidateCache(jobDir)
}

/** Drop a directory's cache entry (force re-read next time). Source: ant o2. */
export function invalidateCache(jobDir: string): void {
  stateCache.delete(jobDir)
}

/** Clear the entire job-state cache. Used by `_resetRemountCachesForTesting`. */
export function clearAllCaches(): void {
  stateCache.clear()
}

/**
 * Read the canonical pin set from pins.json. On miss, migrates from
 * per-job `pinned` marker files (ant `di1`) and persists.
 *
 * Source: ant bp9 + di1 (2507.js:140-175).
 */
export async function readPinSet(): Promise<Set<string>> {
  try {
    const text = await fs.readFile(getPinsPath(), 'utf-8')
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((p): p is string => typeof p === 'string'))
  } catch (err) {
    if (isNoEnt(err)) return migratePinMarkers()
    return new Set()
  }
}

/** Source: ant xp9. */
export async function writePinSet(pins: Set<string>): Promise<void> {
  const path = getPinsPath()
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, JSON.stringify([...pins], null, 2))
}

/**
 * One-time migration: walk jobs/<short>/pinned marker files and seed
 * pins.json. Source: ant di1.
 */
async function migratePinMarkers(): Promise<Set<string>> {
  let entries
  try {
    entries = await fs.readdir(getJobsRoot(), { withFileTypes: true })
  } catch {
    return new Set()
  }
  const pinned: string[] = []
  await Promise.all(
    entries
      .filter(e => e.isDirectory())
      .map(async e => {
        try {
          await fs.access(join(getJobsRoot(), e.name, PINNED_MARKER_FILE))
          pinned.push(e.name)
        } catch {
          // not pinned
        }
      }),
  )
  const set = new Set(pinned)
  await writePinSet(set).catch(err => {
    if (!isNoEnt(err))
      logForDebugging(`[fleet] migrate pins: ${(err as Error).message}`, { level: 'warn' })
  })
  return set
}

/**
 * Enumerate every persisted job, optionally merging in worker presence
 * from the daemon roster (so dying-but-not-yet-deleted workers appear).
 *
 * Source: ant H7H (2507.js:306-326).
 */
export async function listJobsFromDisk(): Promise<FleetJob[]> {
  let entries
  try {
    entries = await fs.readdir(getJobsRoot(), { withFileTypes: true })
  } catch {
    return []
  }

  const [pins, jobs] = await Promise.all([
    readPinSet(),
    Promise.all(
      entries
        .filter(e => e.isDirectory())
        .map(async (e): Promise<FleetJob | null> => {
          const state = await readJobState(join(getJobsRoot(), e.name))
          return state === null ? null : { id: e.name, state }
        }),
    ),
  ])

  return jobs
    .filter((j): j is FleetJob => j !== null)
    .map(j => (pins.has(j.id) ? { ...j, state: { ...j.state, pinned: true } } : j))
}

/**
 * Persist a sortOrder override sibling file.
 * Source: ant pp9 / setSortOrder caller path.
 */
export async function writeSortOrder(jobDir: string, order: number): Promise<void> {
  await fs.mkdir(jobDir, { recursive: true })
  await fs.writeFile(join(jobDir, ORDER_FILE), String(order))
  invalidateCache(jobDir)
}

/** Persist a stateSortOrder override sibling file. */
export async function writeStateSortOrder(jobDir: string, order: number): Promise<void> {
  await fs.mkdir(jobDir, { recursive: true })
  await fs.writeFile(join(jobDir, STATE_ORDER_FILE), String(order))
  invalidateCache(jobDir)
}

/**
 * Mark a job's state.json as stopped. Source: ant Gs3 'stop' action
 * (5092.js:296-347). Sets state='stopped', tempo='idle', detail='stopped',
 * sets firstTerminalAt to now if absent.
 */
export async function markJobStopped(short: string): Promise<void> {
  const dir = getJobDir(short)
  const state = await readJobState(dir)
  if (state === null) return
  const now = new Date().toISOString()
  await writeJobState(dir, {
    ...state,
    state: 'stopped',
    detail: 'stopped',
    tempo: 'idle',
    updatedAt: now,
    firstTerminalAt: state.firstTerminalAt ?? now,
  })
}

/**
 * Wipe the job dir + drop from pins.json. Source: ant u_H (4774.js:264) —
 * the second-Ctrl+X delete that removes the row from disk entirely.
 */
export async function deleteJobDir(short: string): Promise<void> {
  const dir = getJobDir(short)
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
  try {
    const pins = await readPinSet()
    if (pins.has(short)) {
      pins.delete(short)
      await writePinSet(pins)
    }
  } catch {
    // best-effort
  }
  invalidateCache(dir)
}
