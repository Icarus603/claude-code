/**
 * Row → band classifier (band = lifecycle group used by the action menu
 * and the banner count triplet, distinct from the bucket which drives
 * section rendering).
 *
 * Source: ant uyH (5092.js:172-177).
 *
 *   presence === "busy"                  → "active"
 *   terminally idle (and not self-success) → "completed"
 *   tempo === "blocked" || presence === "waiting" → "blocked"
 *   default                               → "active"
 */

import type {
  FleetBand,
  FleetJobState,
  FleetPresence,
} from '@claude-code/agent/background/fleet/fleetTypes.js'
import { stateOutcome, isTerminallyIdle } from './stateOutcome.js'
import { isSelfDriving } from './selfDriving.js'

/** Source: ant uyH. */
export function deriveBand(state: FleetJobState, presence: FleetPresence): FleetBand {
  if (presence === 'busy') return 'active'
  if (isTerminallyIdle(state) && !(stateOutcome(state.state) === 'success' && isSelfDriving(state))) {
    return 'completed'
  }
  if (state.tempo === 'blocked' || presence === 'waiting') return 'blocked'
  return 'active'
}
