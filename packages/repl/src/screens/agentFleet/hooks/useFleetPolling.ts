/**
 * Periodic poll of FleetView state.
 *
 * Source: ant 5092.js polling cluster (around lines 2040-2120) —
 *   - listFleetJobs() every ~1s
 *   - daemonList() every ~1s (for `presence` map)
 *   - PR status refresh every 30s (`Ws3`)
 *   - frame status refresh every 60s
 *
 * Returns the freshest snapshot; caller passes into `useFleetRows`.
 */

import { useEffect, useState } from 'react'

import { daemonList } from '@claude-code/cli/bg/daemonAdapter.js'
import { listFleetJobs } from '@claude-code/agent/background/fleet/listFleetJobs.js'
import type {
  FleetJob,
  FleetPrCache,
  FleetPresence,
} from '@claude-code/agent/background/fleet/fleetTypes.js'

const JOBS_POLL_MS = 1_000

export interface FleetPollResult {
  jobs: FleetJob[]
  presence: Map<string, FleetPresence>
  prCache: FleetPrCache | undefined
  /** Monotonic counter incremented each refresh; useful for debug. */
  generation: number
}

/**
 * Returns a polled snapshot of fleet state. PR cache is currently
 * passed through from a caller-supplied source (Phase 6 wires in the
 * GitHub PR fetcher later); polling here only refreshes jobs+presence.
 */
export function useFleetPolling(seed: readonly FleetJob[] | undefined): FleetPollResult {
  const [result, setResult] = useState<FleetPollResult>(() => ({
    jobs: seed === undefined ? [] : [...seed],
    presence: new Map(),
    prCache: undefined,
    generation: 0,
  }))

  useEffect(() => {
    let cancelled = false
    let gen = 0

    const tick = async (): Promise<void> => {
      try {
        const daemonResp = await daemonList().catch(() => null)
        const jobs = await listFleetJobs(daemonResp ?? undefined)
        if (cancelled) return
        const presence = new Map<string, FleetPresence>()
        if (daemonResp !== null && daemonResp.ok === true) {
          const workers = (daemonResp as { workers?: unknown }).workers
          if (Array.isArray(workers)) {
            for (const w of workers) {
              if (typeof w === 'object' && w !== null) {
                const ww = w as Record<string, unknown>
                const short = ww.short
                const presenceKind = ww.presence
                if (typeof short === 'string') {
                  if (
                    presenceKind === 'busy' ||
                    presenceKind === 'shell' ||
                    presenceKind === 'waiting'
                  ) {
                    presence.set(short, presenceKind)
                  } else {
                    presence.set(short, undefined)
                  }
                }
              }
            }
          }
        }
        gen += 1
        setResult({ jobs, presence, prCache: undefined, generation: gen })
      } catch (err) {
        if (!cancelled) {
          console.warn(`[fleet] poll failed: ${(err as Error).message}`)
        }
      }
    }

    void tick()
    const handle = setInterval(() => void tick(), JOBS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [])

  return result
}
