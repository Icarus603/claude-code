/**
 * Public entry point — enumerate every FleetJob known to the local
 * persistence layer + daemon roster.
 *
 * Source: ant H7H (2507.js:306) + Fp9 (2507.js:379-407) — disk read
 * merged with daemon-roster adoption for workers that haven't yet
 * persisted state.
 */

import type { Response as DaemonResponse } from '@claude-code/daemon/daemonClient.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import type {
  FleetDaemonWorker,
  FleetJob,
  FleetJobState,
} from './fleetTypes.js'
import { getJobDir, listJobsFromDisk, writeJobState } from './fleetStore.js'

/**
 * Build a default FleetJobState for a freshly-adopted daemon worker
 * that has no on-disk state.json yet. Source: ant _7H (2507.js:348-378).
 */
function newJobStateForWorker(worker: FleetDaemonWorker): FleetJobState {
  const now = new Date().toISOString()
  return {
    state: 'working',
    detail: worker.detail || '',
    tempo: 'active',
    output: null,
    children: null,
    linkScanOffset: 0,
    template: worker.agent ?? 'bg',
    routine: worker.routine,
    respawnFlags: [],
    intent: worker.intent,
    name: worker.name,
    initialPrompt: undefined,
    sessionId: worker.sessionId,
    resumeSessionId: worker.sessionId,
    daemonShort: worker.sessionId.slice(0, 8),
    cwd: worker.cwd,
    createdAt: now,
    updatedAt: now,
    firstTerminalAt: null,
    worktreePath: worker.worktreePath,
    backend: 'daemon',
  }
}

/**
 * Adopt daemon workers that have no on-disk job dir. Writes minimal
 * state.json so subsequent runs see them. Source: ant Fp9.
 *
 * Returns the FleetJob entries that were freshly adopted.
 */
async function adoptOrphanWorkers(
  diskJobs: readonly FleetJob[],
  workers: readonly FleetDaemonWorker[],
): Promise<FleetJob[]> {
  if (workers.length === 0) return []
  const known = new Set(diskJobs.map(j => j.id))
  const orphans = workers.filter(
    w => !known.has(w.short) && w.source !== 'spare' && w.dying !== true,
  )
  if (orphans.length === 0) return []

  return Promise.all(
    orphans.map(async w => {
      const state = newJobStateForWorker(w)
      const jobDir = getJobDir(w.short)
      await writeJobState(jobDir, state).catch(err => {
        if ((err as { code?: string }).code !== 'EEXIST') {
          logForDebugging(`[fleet] adopt ${w.short}: ${(err as Error).message}`, { level: 'warn' })
        }
      })
      return { id: w.short, state }
    }),
  )
}

/**
 * Coerce a daemon list response into FleetDaemonWorker[] — defensive
 * against the daemon protocol changing.
 */
function parseDaemonWorkers(response: DaemonResponse): FleetDaemonWorker[] {
  if (response.ok === false) return []
  const raw = (response as { workers?: unknown }).workers
  if (!Array.isArray(raw)) return []
  const out: FleetDaemonWorker[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const w = entry as Record<string, unknown>
    if (typeof w.short !== 'string') continue
    if (typeof w.sessionId !== 'string') continue
    out.push({
      short: w.short,
      sessionId: w.sessionId,
      agent: typeof w.agent === 'string' ? w.agent : undefined,
      routine: typeof w.routine === 'string' ? w.routine : undefined,
      intent: typeof w.intent === 'string' ? w.intent : '',
      name: typeof w.name === 'string' ? w.name : undefined,
      detail: typeof w.detail === 'string' ? w.detail : '',
      cwd: typeof w.cwd === 'string' ? w.cwd : '',
      worktreePath: typeof w.worktreePath === 'string' ? w.worktreePath : undefined,
      source: typeof w.source === 'string' ? w.source : undefined,
      dying: w.dying === true,
    })
  }
  return out
}

/**
 * Main FleetView job enumerator. Walks disk, optionally adopts orphan
 * daemon workers, returns the unified job list.
 *
 * Source: ant H7H (2507.js:306-326).
 */
export async function listFleetJobs(
  daemonWorkers?: readonly FleetDaemonWorker[] | DaemonResponse,
): Promise<FleetJob[]> {
  const diskJobs = await listJobsFromDisk()
  if (daemonWorkers === undefined) return diskJobs

  const workers = Array.isArray(daemonWorkers)
    ? daemonWorkers
    : parseDaemonWorkers(daemonWorkers as DaemonResponse)

  if (workers.length === 0) return diskJobs

  const adopted = await adoptOrphanWorkers(diskJobs, workers)
  return adopted.length === 0 ? diskJobs : [...diskJobs, ...adopted]
}
