/**
 * Roll up a job state into its FleetActivity colour bucket.
 * Source: ant GZ6 (5092.js:154-171).
 *
 * Returns:
 *   "success" — terminal success (or all child PRs merged for skill jobs)
 *   "failure" — terminal failed
 *   "stopped" — terminal stopped
 *   "flowing" — active or recently updated (under 3·O minutes idle)
 *   "slowing" — moderately idle (under 15·O minutes)
 *   "stuck"   — past slowing threshold
 *
 * O = 1 when tempo === "active", else 5 — so an idle (waiting) row decays
 * 5× slower than an actively-spinning one.
 */

import type {
  FleetActivity,
  FleetJobState,
  FleetPrCache,
} from '@claude-code/agent/background/fleet/fleetTypes.js'
import { stateOutcome } from './stateOutcome.js'
import { isSelfDriving } from './selfDriving.js'

/**
 * Default agent template. Source: ant `a1H.name` (4775.js) = "claude" —
 * the CLAUDE_AGENT built-in (2855.js Aj8). ccb uses 'bg' as its default
 * template (listFleetJobs.ts:31 falls back to 'bg' when no agent name
 * is recorded). The check below rolls up the default-agent row to
 * "success" when all its child PRs have merged — a "you can stop
 * watching this one" signal specific to the leader template that
 * dispatched sub-PRs.
 */
const DEFAULT_AGENT_TEMPLATE = 'bg'

/** Source: ant GZ6. */
export function deriveActivity(
  state: FleetJobState,
  prCache: FleetPrCache | undefined,
): FleetActivity {
  const outcome = stateOutcome(state.state)
  if (outcome !== null && state.tempo !== 'active' && !(outcome === 'success' && isSelfDriving(state))) {
    return outcome
  }
  const liveChildren = state.children?.filter(c => c.kind !== 'frame')
  if (
    prCache !== undefined &&
    state.tempo !== 'active' &&
    state.template === DEFAULT_AGENT_TEMPLATE &&
    liveChildren !== undefined &&
    liveChildren.length > 0 &&
    liveChildren.every(c => prCache.get(c.href)?.state === 'MERGED')
  ) {
    return 'success'
  }
  const o = state.tempo === 'active' ? 1 : 5
  const dt = Date.now() - Date.parse(state.updatedAt)
  if (dt < o * 3 * 60_000) return 'flowing'
  if (dt < o * 15 * 60_000) return 'slowing'
  return 'stuck'
}
