/**
 * Bridge a bg session's runtime activity into the on-disk state.json
 * that FleetView polls.
 *
 * ccb's bg worker has no daemon supervisor (unlike ant, which uses
 * 4835.js WorkerVm + 3988.js text inference to update state.json on
 * every assistant turn). Without these, the disk state never advances
 * past the seed `state: 'working'` / `tempo: 'active'` written by
 * spawnBgPty — so FleetView's "Working" count never decrements when
 * the assistant finishes, and the row never moves to the Completed
 * bucket.
 *
 * Minimal port from ant's signals (3988.js + 4835.js): drive state
 * transitions off the REPL's `isLoading` flag. The lifecycle is:
 *
 *   mount (isLoading=true):       state=working, tempo=active
 *   turn complete (true→false):   state=done,    tempo=idle, firstTerminalAt=now
 *   new user message (false→true): state=working, tempo=active
 *
 * This isn't the full ant text-inference engine — `result-marker` /
 * `blocked-marker` / `ready-for` etc. (3988.js) detect specific
 * patterns in assistant output and write distinct state values. The
 * one-shot done/working toggle here matches the user's expectation
 * that a session showing "Working" rolls over to "Completed" as soon
 * as the assistant finishes responding, and reverts on follow-up.
 *
 * Gated on `CLAUDE_CODE_SESSION_KIND === 'bg'` AND `CLAUDE_JOB_DIR`
 * being set — both written by spawnPty so the foreground REPL is
 * unaffected.
 */

import { useEffect, useRef } from 'react'
import {
  readJobState,
  writeJobState,
  invalidateCache,
} from '@claude-code/agent/background/fleet/fleetStore.js'

export function useBgFleetStateSync(isLoading: boolean): void {
  const previousLoadingRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (process.env.CLAUDE_CODE_SESSION_KIND !== 'bg') return
    const jobDir = process.env.CLAUDE_JOB_DIR
    if (!jobDir) return

    const previous = previousLoadingRef.current
    previousLoadingRef.current = isLoading

    // No-op on first effect run (mount) — the seed state.json from
    // spawnBgPty already encodes `state=working, tempo=active`. We only
    // intervene on subsequent transitions to avoid clobbering the
    // dispatch-time intent/name fields with a partial update.
    if (previous === null) return
    if (previous === isLoading) return

    void (async () => {
      try {
        invalidateCache(jobDir)
        const current = await readJobState(jobDir)
        if (!current) return

        const now = new Date().toISOString()
        if (isLoading) {
          // false → true: new user turn started — back to working.
          // Don't overwrite if it's already in a terminal state we
          // shouldn't undo (e.g. user typed /exit then re-entered).
          if (current.state === 'stopped' || current.state === 'failed') return
          if (current.state === 'working' && current.tempo === 'active') return
          await writeJobState(jobDir, {
            ...current,
            state: 'working',
            tempo: 'active',
            updatedAt: now,
          })
        } else {
          // true → false: assistant turn complete — mark done/idle so
          // FleetView buckets the row as Completed. This is the one-shot
          // model — ant's text-inference engine (3988.js) produces finer
          // states (`blocked` when assistant asks a follow-up question,
          // `failed` on giving-up phrases, etc.) but a single
          // turn-complete signal covers the user's reported regression.
          if (current.state === 'stopped' || current.state === 'failed') return
          await writeJobState(jobDir, {
            ...current,
            state: 'done',
            tempo: 'idle',
            updatedAt: now,
            firstTerminalAt: current.firstTerminalAt ?? now,
          })
        }
      } catch {
        // Best-effort — disk sync is observability, not correctness.
      }
    })()
  }, [isLoading])
}
