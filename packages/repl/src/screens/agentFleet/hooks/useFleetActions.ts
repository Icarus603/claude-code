/**
 * Action dispatchers for the FleetView.
 *
 * Source: ant 5092.js action handlers — Gs3 (band-action factory at
 * 5092.js:290) plus inline ctrl+r/ctrl+t/ctrl+x/space handlers in xd
 * (5092.js:2767+).
 *
 * Each action is exposed as an async function that returns
 * `{ok: true} | {ok: false, error}` so the caller (useFleetInput) can
 * surface a toast on failure without throwing.
 */

import { useCallback, useMemo } from 'react'

import { replyToFleetJob } from '@claude-code/agent/background/fleet/replyToFleetJob.js'
import { setFleetJobPinned } from '@claude-code/agent/background/fleet/pinFleetJob.js'
import { renameFleetJob } from '@claude-code/agent/background/fleet/renameFleetJob.js'
import {
  setFleetSortOrder,
  setFleetStateSortOrder,
} from '@claude-code/agent/background/fleet/sortFleetJobs.js'
import {
  deleteJobDir,
  markJobStopped,
} from '@claude-code/agent/background/fleet/fleetStore.js'
import { daemonKill, daemonRespawn } from '@claude-code/cli/bg/daemonAdapter.js'

export type FleetActionResult = { ok: true } | { ok: false; error: string }

export interface UseFleetActionsArgs {
  /** Caller's foreground session id (for rename routing). */
  currentSessionId: string
}

export interface FleetActions {
  reply(short: string, text: string): Promise<FleetActionResult>
  togglePin(short: string, nextPinned: boolean): Promise<FleetActionResult>
  rename(sessionId: string, newName: string): Promise<FleetActionResult>
  reorder(short: string, newSortOrder: number): Promise<FleetActionResult>
  reorderInBucket(short: string, newStateSortOrder: number): Promise<FleetActionResult>
  /**
   * Stop a running worker: best-effort daemon kill + mark state.json
   * as stopped. Mirrors ant Gs3 'stop' action (5092.js:296-347). The
   * row stays in the list as "stopped"; second Ctrl+X removes it.
   */
  stop(short: string): Promise<FleetActionResult>
  /**
   * Delete the job dir entirely. Mirrors ant Gs3 'delete' (5092.js:353
   * + u_H 4774.js:264). The row disappears from the list.
   */
  remove(short: string): Promise<FleetActionResult>
  kill(short: string): Promise<FleetActionResult>
  respawn(short: string): Promise<FleetActionResult>
}

function err(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Source: ant action handlers in xd + Gs3. */
export function useFleetActions({
  currentSessionId,
}: UseFleetActionsArgs): FleetActions {
  const reply = useCallback(
    async (short: string, text: string): Promise<FleetActionResult> => {
      const result = await replyToFleetJob(short, text)
      if (result.ok === true) return { ok: true }
      return { ok: false, error: result.error }
    },
    [],
  )

  const togglePin = useCallback(
    async (short: string, nextPinned: boolean): Promise<FleetActionResult> => {
      try {
        await setFleetJobPinned(short, nextPinned)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: err(e) }
      }
    },
    [],
  )

  const rename = useCallback(
    async (sessionId: string, newName: string): Promise<FleetActionResult> => {
      const ok = await renameFleetJob(currentSessionId, sessionId, newName, 'user')
      if (ok) return { ok: true }
      return { ok: false, error: 'rename failed' }
    },
    [currentSessionId],
  )

  const reorder = useCallback(
    async (short: string, newSortOrder: number): Promise<FleetActionResult> => {
      try {
        await setFleetSortOrder(short, newSortOrder)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: err(e) }
      }
    },
    [],
  )

  const reorderInBucket = useCallback(
    async (short: string, newStateSortOrder: number): Promise<FleetActionResult> => {
      try {
        await setFleetStateSortOrder(short, newStateSortOrder)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: err(e) }
      }
    },
    [],
  )

  const kill = useCallback(async (short: string): Promise<FleetActionResult> => {
    const r = await daemonKill({ short })
    if (r.ok === true) return { ok: true }
    return { ok: false, error: r.error ?? 'daemon kill failed' }
  }, [])

  /**
   * 'stop' action — daemon kill (best-effort, ignores ENOJOB / no daemon)
   * + mark state.json as stopped. Source: ant Gs3 first entry.
   */
  const stop = useCallback(async (short: string): Promise<FleetActionResult> => {
    // Daemon kill is best-effort: if daemon isn't running OR doesn't
    // know about this job, we still mark the on-disk state as stopped.
    await daemonKill({ short }).catch(() => undefined)
    try {
      await markJobStopped(short)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: err(e) }
    }
  }, [])

  /**
   * 'delete' action — wipe the job dir from disk. Source: ant u_H.
   */
  const remove = useCallback(async (short: string): Promise<FleetActionResult> => {
    // Best-effort daemon kill first (no-op if not running).
    await daemonKill({ short }).catch(() => undefined)
    try {
      await deleteJobDir(short)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: err(e) }
    }
  }, [])

  const respawn = useCallback(async (short: string): Promise<FleetActionResult> => {
    const r = await daemonRespawn(short)
    if (r.ok === true) return { ok: true }
    return { ok: false, error: r.error ?? 'daemon respawn failed' }
  }, [])

  return useMemo(
    () => ({
      reply,
      togglePin,
      rename,
      reorder,
      reorderInBucket,
      stop,
      remove,
      kill,
      respawn,
    }),
    [reply, togglePin, rename, reorder, reorderInBucket, stop, remove, kill, respawn],
  )
}
