/**
 * Teammate color assignment — extracted from teammateLayoutManager.ts to
 * break the 3-file PaneBackendExecutor → teammateLayoutManager → registry
 * cycle. The color functions are pure (no backend dependency); the rest
 * of teammateLayoutManager (createTeammatePaneInSwarmView, etc.) keeps
 * its registry-backend coupling.
 */

import type { AgentColorName } from '../adapters/appRuntime.js'
import { AGENT_COLORS } from '../adapters/appRuntime.js'

const teammateColorAssignments = new Map<string, AgentColorName>()
let colorIndex = 0

export function assignTeammateColor(teammateId: string): AgentColorName {
  const existing = teammateColorAssignments.get(teammateId)
  if (existing) {
    return existing
  }
  const color = AGENT_COLORS[colorIndex % AGENT_COLORS.length]!
  teammateColorAssignments.set(teammateId, color)
  colorIndex++
  return color
}

export function getTeammateColor(
  teammateId: string,
): AgentColorName | undefined {
  return teammateColorAssignments.get(teammateId)
}

export function clearTeammateColors(): void {
  teammateColorAssignments.clear()
  colorIndex = 0
}
