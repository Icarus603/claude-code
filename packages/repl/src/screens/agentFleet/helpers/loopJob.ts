/**
 * `/loop` job detector — both initial prompt and intent are checked.
 * Source: ant WR_ (5092.js:592-594).
 */

import type { FleetJobState } from '@claude-code/agent/background/fleet/fleetTypes.js'

function startsWithLoop(text: string | undefined): boolean {
  return text?.trim().toLowerCase().startsWith('/loop') ?? false
}

/** Source: ant WR_. */
export function isLoopJob(state: FleetJobState): boolean {
  return startsWithLoop(state.intent) || startsWithLoop(state.initialPrompt)
}
