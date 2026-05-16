/**
 * Enumerate agent templates available for `claude agents` dispatch.
 *
 * Source: ant dGK (5092.js — agent template listing). ccb already
 * resolves agent overrides via `tool-registry/AgentTool/loadAgentsDir`;
 * this helper wraps that into a fleet-shaped summary.
 */

import {
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
} from '@claude-code/tool-registry/tools/AgentTool/loadAgentsDir.js'

export interface FleetAgentTemplate {
  /** Template name as it appears in `state.template` / `a:NAME` filter. */
  name: string
  /** Optional human-readable description from the agent's frontmatter. */
  description?: string
  /** Optional agent type override (e.g. "claude" / "general-purpose"). */
  agentType?: string
  /** Source (built-in / user / project / plugin). */
  source?: string
  /** Where this agent was loaded from (file path, when known). */
  filename?: string
}

/**
 * Source: ant dGK → summariseAgent.
 *
 * Returns the deduplicated set of active templates for the given cwd.
 */
export async function listAgentTemplates(cwd: string): Promise<FleetAgentTemplate[]> {
  const { allAgents } = await getAgentDefinitionsWithOverrides(cwd)
  const active = getActiveAgentsFromList(allAgents)
  return active.map(a => ({
    name: a.agentType,
    description: a.whenToUse,
    agentType: a.agentType,
    source: a.source,
    filename: (a as { filename?: string }).filename,
  }))
}
