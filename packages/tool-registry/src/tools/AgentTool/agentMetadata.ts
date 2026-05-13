/**
 * Build the metadata bag passed to finalizeAgentTool() / tengu_agent_tool_completed
 * / subagent_completed OTel. Extracted from AgentTool.tsx so the call site stays
 * a single function call and the file-size ratchet doesn't drift.
 */

import { parsePluginIdentifier } from '@claude-code/config/plugin/pluginIdentifier'
import {
  type AgentDefinition,
  isBuiltInAgent,
} from './loadAgentsDir.js'

interface BuildAgentMetadataArgs {
  selectedAgent: AgentDefinition
  prompt: string
  resolvedAgentModel: string
  startTime: number
  isAsync: boolean
}

export interface AgentMetadata {
  prompt: string
  resolvedAgentModel: string
  isBuiltInAgent: boolean
  startTime: number
  agentType: string
  isAsync: boolean
  source: string
  pluginInfo?: { name: string; marketplace?: string }
}

export function buildAgentMetadata(args: BuildAgentMetadataArgs): AgentMetadata {
  const { selectedAgent, prompt, resolvedAgentModel, startTime, isAsync } = args
  // ant V36 (3660.js:170) — Plugin agents carry a single string
  // `name@marketplace` identifier; split it so the emit site doesn't re-parse.
  const parsed =
    selectedAgent.source === 'plugin' && 'plugin' in selectedAgent
      ? parsePluginIdentifier(selectedAgent.plugin)
      : undefined
  return {
    prompt,
    resolvedAgentModel,
    isBuiltInAgent: isBuiltInAgent(selectedAgent),
    startTime,
    agentType: selectedAgent.agentType,
    isAsync,
    source: selectedAgent.source,
    ...(parsed?.name && {
      pluginInfo: {
        name: parsed.name,
        ...(parsed.marketplace && { marketplace: parsed.marketplace }),
      },
    }),
  }
}
