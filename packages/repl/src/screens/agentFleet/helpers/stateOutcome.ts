/**
 * Map FleetJobStatus → terminal-outcome token.
 *
 * Source: ant bZH (2507.js:409-413) + lR (415) + iD (418).
 *
 *   bZH("done")    → "success"
 *   bZH("failed")  → "failure"
 *   bZH("stopped") → "stopped"
 *   bZH(other)     → null  (working/blocked)
 *
 *   lR(state)    = bZH(state) !== null  // is terminal
 *   iD(jobState) = lR(jobState.state) && jobState.tempo !== "active"
 *                  // terminal + not actively respawning
 */

import type {
  FleetJobState,
  FleetJobStatus,
} from '@claude-code/agent/background/fleet/fleetTypes.js'

export type FleetOutcome = 'success' | 'failure' | 'stopped'

/** Source: ant bZH. */
export function stateOutcome(status: FleetJobStatus): FleetOutcome | null {
  if (status === 'done') return 'success'
  if (status === 'failed') return 'failure'
  if (status === 'stopped') return 'stopped'
  return null
}

/** Source: ant lR. */
export function isTerminalStatus(status: FleetJobStatus): boolean {
  return stateOutcome(status) !== null
}

/** Source: ant iD. */
export function isTerminallyIdle(state: FleetJobState): boolean {
  return isTerminalStatus(state.state) && state.tempo !== 'active'
}
