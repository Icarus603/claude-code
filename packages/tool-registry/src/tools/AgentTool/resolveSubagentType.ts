/**
 * Resolve a subagent_type string to an AgentDefinition, with v140's
 * case+separator-insensitive fuzzy fallback.
 *
 * Port of ant v2.1.140 3751.js:248 + 3750.js:II7 (the normalizer).
 *
 * Flow:
 *   1. Exact match (existing behavior) → return.
 *   2. NFKC + lowercase + strip [\p{White_Space}\p{Pd}_] on both
 *      requested + each agent's agentType. Filter `allAgents` by equal
 *      normalized form.
 *   3a. ≥2 fuzzy matches → throw ambiguous error listing candidates.
 *   3b. Exactly 1 fuzzy match in `agents` (allowed set) → return that
 *       candidate (telemetry: tengu_subagent_type_normalized).
 *   3c. Exactly 1 fuzzy match but denied → throw deny error.
 *   3d. Zero fuzzy → telemetry tengu_subagent_type_miss; return null
 *       so the caller falls through to the existing "not found" path.
 */

import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import type { AgentDefinition } from './loadAgentsDir.js'
import { normalizeAgentType } from './normalizeAgentType.js'
import { AGENT_TOOL_NAME } from './constants.js'

export interface SubagentResolveContext {
  allAgents: AgentDefinition[]
  agents: AgentDefinition[]
  getDenyRule: (toolName: string, input: string) => { source: string } | undefined
}

export function resolveSubagentTypeWithFuzzy(
  effectiveType: string,
  ctx: SubagentResolveContext,
): AgentDefinition | null {
  const requestedNormalized = normalizeAgentType(effectiveType)
  const fuzzyMatches = ctx.allAgents.filter(
    a => normalizeAgentType(a.agentType) === requestedNormalized,
  )
  const availableSet = new Set(ctx.agents.map(a => a.agentType))

  if (fuzzyMatches.length > 1) {
    logEvent('tengu_subagent_type_miss', {
      requestedNormalized:
        requestedNormalized as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      availableCount: ctx.agents.length,
      ambiguousCount: fuzzyMatches.length,
    })
    const availableMatches = fuzzyMatches
      .map(m => m.agentType)
      .filter(t => availableSet.has(t))
    const detail = fuzzyMatches
      .map(m =>
        availableSet.has(m.agentType) ? m.agentType : `${m.agentType} (unavailable)`,
      )
      .join(', ')
    throw new Error(
      `Agent type '${effectiveType}' is ambiguous — matches ${detail}. ${
        availableMatches.length > 0
          ? `Use the exact name: ${availableMatches.join(' or ')}`
          : `None of these are available. Available agents: ${ctx.agents.map(a => a.agentType).join(', ')}`
      }`,
    )
  }

  if (fuzzyMatches.length === 1) {
    const candidate = fuzzyMatches[0]!
    if (availableSet.has(candidate.agentType)) {
      logEvent('tengu_subagent_type_normalized', {
        requestedNormalized:
          requestedNormalized as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        matched: candidate.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return candidate
    }
    const denyRule = ctx.getDenyRule(AGENT_TOOL_NAME, candidate.agentType)
    throw new Error(
      `Agent type '${candidate.agentType}' has been denied by permission rule '${AGENT_TOOL_NAME}(${candidate.agentType})' from ${denyRule?.source ?? 'settings'}.`,
    )
  }

  // No fuzzy candidate either.
  logEvent('tengu_subagent_type_miss', {
    requestedNormalized:
      requestedNormalized as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    availableCount: ctx.agents.length,
  })
  return null
}
