/**
 * Roll up a PR status summary to a single colour token.
 * Source: ant M$6 (caller of $i8 at 5092.js:433-435).
 *
 * Per-row consumer (PR child rollup at 5092.js:488-491) treats `error`
 * specially as the only "fail" signal — pending checks render warning.
 */

import type { FleetPrSummary } from '@claude-code/agent/background/fleet/fleetTypes.js'

/** Source: ant M$6 caller. */
export function childStatusColor(
  pr: FleetPrSummary,
): 'error' | 'warning' | 'success' | undefined {
  if (pr.state === 'MERGED') return undefined
  if (pr.state === 'CLOSED') return undefined
  if (pr.checks.failed > 0) return 'error'
  if (pr.checks.pending > 0) return 'warning'
  if (pr.checks.passed > 0) return 'success'
  if (pr.review === 'CHANGES_REQUESTED') return 'error'
  if (pr.review === 'REVIEW_REQUIRED') return 'warning'
  return undefined
}

/**
 * Same as childStatusColor but with the "error→warning" demotion ant
 * applies in $i8 (5092.js:433-435) for the parent rollup color.
 */
export function childRollupColor(
  pr: FleetPrSummary,
): 'warning' | 'success' | undefined {
  const c = childStatusColor(pr)
  if (c === 'error') return 'warning'
  if (c === 'warning') return 'warning'
  if (c === 'success') return 'success'
  return undefined
}
