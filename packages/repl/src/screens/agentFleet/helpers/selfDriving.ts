/**
 * Row "self-driving" predicate.
 *
 * A row is self-driving when ant has reason to believe it will keep
 * making progress without human input — currently:
 *   - has a routine attached (background routine driving it)
 *   - has `inFlight.kinds` including `"session_cron"` (cron timer mid-tick)
 *   - is a `/loop` job (detected by intent prefix)
 *
 * Source: ant yZ6 (5092.js:596-597) + WR_ (5092.js:592-594).
 *
 * Self-driving rows skip the "review" classification even if their
 * children have unresolved PR checks (PZ6:186-194).
 */

import type { FleetJobState } from '@claude-code/agent/background/fleet/fleetTypes.js'
import { isLoopJob } from './loopJob.js'

/** Source: ant yZ6. */
export function isSelfDriving(state: FleetJobState): boolean {
  if (state.routine !== undefined) return true
  if (state.inFlight?.kinds.includes('session_cron') === true) return true
  return isLoopJob(state)
}
