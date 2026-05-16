/**
 * Row → bucket classifier. Source: ant PZ6 (5092.js:181-199).
 *
 * Cascade (first match wins):
 *   1. presence === "busy"          → "working"
 *   2. activity === "failure"|"stopped" → "done"
 *   3. presence === "waiting"       → "blocked"
 *   4. has child PRs with error/non-approved warning → "review"
 *   5. activity === "success"       → "done"
 *   6. tempo === "blocked"          → "blocked"
 *   7. default                       → "working"
 */

import type {
  FleetActivity,
  FleetBucket,
  FleetJobState,
  FleetPrCache,
  FleetPresence,
} from '@claude-code/agent/background/fleet/fleetTypes.js'
import { isSelfDriving } from './selfDriving.js'
import { childStatusColor } from './childStatusColor.js'

/**
 * Per-row classifier input: the rolled-up FleetJob view that aggregates
 * `state` with the derived `activity`. Source: the same shape ant
 * passes into PZ6 — `{state, activity}`.
 */
export interface BucketClassifierInput {
  state: FleetJobState
  activity?: FleetActivity
}

/**
 * Classify a row into one of four buckets. Source: ant PZ6.
 *
 * @param row       Row view with FleetJobState + computed FleetActivity.
 * @param prCache   PR status cache used to detect "review" bucket.
 * @param presence  Worker presence reported by the daemon roster.
 */
export function stateBucket(
  row: BucketClassifierInput,
  prCache: FleetPrCache | undefined,
  presence: FleetPresence,
): FleetBucket {
  if (presence === 'busy') return 'working'
  if (row.activity === 'failure') return 'done'
  if (row.activity === 'stopped') return 'done'
  if (presence === 'waiting') return 'blocked'
  if (
    !isSelfDriving(row.state) &&
    row.state.children?.some(child => {
      const pr = prCache?.get(child.href)
      if (pr?.state !== 'OPEN') return false
      const color = childStatusColor(pr)
      return color === 'error' || (color === 'warning' && pr.review !== 'APPROVED')
    })
  ) {
    return 'review'
  }
  if (row.activity === 'success') return 'done'
  if (row.state.tempo === 'blocked') return 'blocked'
  return 'working'
}
