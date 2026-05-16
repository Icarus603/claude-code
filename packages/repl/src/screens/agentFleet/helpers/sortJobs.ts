/**
 * Job sort helpers.
 *
 * Source: ant VZ6 (5092.js:508-510), fR_ (5092.js:511-514), XR_ (5092.js:516-518).
 *
 * Sort key:
 *   effectiveSortOrder(state) = state.sortOrder ?? Date.parse(state.createdAt)
 *
 * For "done" bucket, the per-state effective key uses `firstTerminalAt`
 * (or `updatedAt` fallback) rather than `createdAt` so completed jobs
 * order by when they finished, not when they started.
 */

import type {
  FleetBucket,
  FleetJob,
  FleetJobState,
} from '@claude-code/agent/background/fleet/fleetTypes.js'

/** Source: ant VZ6. */
export function effectiveSortOrder(state: FleetJobState): number {
  return state.sortOrder ?? Date.parse(state.createdAt)
}

/** Source: ant fR_. */
export function effectiveStateSortOrder(state: FleetJobState, bucket: FleetBucket): number {
  if (state.stateSortOrder !== undefined) return state.stateSortOrder
  if (bucket === 'done') {
    return Date.parse(state.firstTerminalAt ?? state.updatedAt)
  }
  return Date.parse(state.updatedAt)
}

/** Source: ant XR_. */
export function sortJobs(jobs: readonly FleetJob[]): FleetJob[] {
  return [...jobs].sort((a, b) => effectiveSortOrder(a.state) - effectiveSortOrder(b.state))
}
