/**
 * Predicate: does this row need respawning (failed/stopped while still
 * marked attachable)?
 *
 * Source: ant qi8 (5092.js:200-203).
 *
 *   bZH(state.state) === "failure"|"stopped" && iD(jobState)
 */

import type { FleetJob } from '@claude-code/agent/background/fleet/fleetTypes.js'
import { isTerminallyIdle, stateOutcome } from './stateOutcome.js'

/** Source: ant qi8. */
export function needsRespawn(job: FleetJob): boolean {
  const outcome = stateOutcome(job.state.state)
  return (outcome === 'failure' || outcome === 'stopped') && isTerminallyIdle(job.state)
}
