/**
 * Row glyph color + dim decision.
 *
 * Source: ant Ti8 (5092.js:403-408) + vs3 (5092.js:410-418).
 *
 *   activity ∈ {success,failure,stopped} && isTerminalIdle → {color: vs3(activity), dim: false}
 *   presence ∈ {busy,shell}                                → {color: undefined,    dim: false}
 *   tempo === "blocked" || presence === "waiting"          → {color: "warning",    dim: false}
 *   default                                                 → {color: undefined,    dim: true}
 *
 *   vs3:
 *     "success" → "success"
 *     "failure" → "error"
 *     "stopped" → "inactive"
 */

import type {
  FleetActivity,
  FleetJobState,
  FleetPresence,
} from '@claude-code/agent/background/fleet/fleetTypes.js'
import { stateOutcome } from './stateOutcome.js'

export type GlyphColor = 'success' | 'error' | 'warning' | 'inactive' | undefined

export interface GlyphColorResult {
  color: GlyphColor
  dim: boolean
}

/** Source: ant vs3. */
function outcomeToColor(outcome: FleetActivity): GlyphColor {
  if (outcome === 'success') return 'success'
  if (outcome === 'failure') return 'error'
  if (outcome === 'stopped') return 'inactive'
  return undefined
}

/** Source: ant Ti8. */
export function glyphColor(
  state: FleetJobState,
  activity: FleetActivity | undefined,
  presence: FleetPresence,
): GlyphColorResult {
  if (
    (activity === 'success' || activity === 'failure' || activity === 'stopped') &&
    stateOutcome(state.state) !== null
  ) {
    return { color: outcomeToColor(activity), dim: false }
  }
  if (presence === 'busy' || presence === 'shell') {
    return { color: undefined, dim: false }
  }
  if (state.tempo === 'blocked' || presence === 'waiting') {
    return { color: 'warning', dim: false }
  }
  return { color: undefined, dim: true }
}
