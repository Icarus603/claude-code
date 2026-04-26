/**
 * Standalone agent utilities for sessions with custom names/colors
 *
 * These helpers provide access to standalone agent context (name and color)
 * for sessions that are NOT part of a swarm team. When a session is part
 * of a swarm, these functions return undefined to let swarm context take
 * precedence.
 */

type AppState = unknown // V7-EXEMPT: legacy state shape, see app-host/state for canonical
import { getTeamName } from '@claude-code/swarm/teammateState.js'

/**
 * Returns the standalone agent name if set and not a swarm teammate.
 * Uses getTeamName() for consistency with isTeammate() swarm detection.
 */
export function getStandaloneAgentName(appState: AppState): string | undefined {
  // If in a team (swarm), don't return standalone name
  if (getTeamName()) {
    return undefined
  }
  return appState.standaloneAgentContext?.name
}
