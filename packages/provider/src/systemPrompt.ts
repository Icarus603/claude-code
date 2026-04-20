import { feature } from 'bun:bundle'
import { readEnv, isEnvTruthy } from '@claude-code/config/env/utils'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import type { ToolUseContext } from '@claude-code/tool-registry/Tool.js'
import type { AgentDefinition } from '@claude-code/tool-registry/tools/AgentTool/loadAgentsDir.js'
import { isBuiltInAgent } from '@claude-code/tool-registry/tools/AgentTool/loadAgentsDir.js'
import { asSystemPrompt, type SystemPrompt } from './systemPromptType.js'

export { asSystemPrompt, type SystemPrompt } from './systemPromptType.js'

// Dead code elimination: conditional import for proactive mode.
// Same pattern as prompts.ts — lazy require to avoid pulling the module
// into non-proactive builds. Proactive module lives in src/ (internal, no
// canonical package owner yet), so the lazy require goes through src path.
/* eslint-disable @typescript-eslint/no-require-imports */
// eslint-disable-next-line no-restricted-imports
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? (require('src/proactive/index.js') as typeof import('src/proactive/index.js'))
    : null
/* eslint-enable @typescript-eslint/no-require-imports */

function isProactiveActive_SAFE_TO_CALL_ANYWHERE(): boolean {
  return proactiveModule?.isProactiveActive() ?? false
}

/**
 * Builds the effective system prompt array based on priority:
 * 0. Override system prompt (if set, e.g., via loop mode - REPLACES all other prompts)
 * 1. Coordinator system prompt (if coordinator mode is active)
 * 2. Agent system prompt (if mainThreadAgentDefinition is set)
 *    - In proactive mode: agent prompt is APPENDED to default (agent adds domain
 *      instructions on top of the autonomous agent prompt, like teammates do)
 *    - Otherwise: agent prompt REPLACES default
 * 3. Custom system prompt (if specified via --system-prompt)
 * 4. Default system prompt (the standard Claude Code prompt)
 *
 * Plus appendSystemPrompt is always added at the end if specified (except when override is set).
 */
export function buildEffectiveSystemPrompt({
  mainThreadAgentDefinition,
  toolUseContext,
  customSystemPrompt,
  defaultSystemPrompt,
  appendSystemPrompt,
  overrideSystemPrompt,
}: {
  mainThreadAgentDefinition: AgentDefinition | undefined
  toolUseContext: Pick<ToolUseContext, 'options'>
  customSystemPrompt: string | undefined
  defaultSystemPrompt: string[]
  appendSystemPrompt: string | undefined
  overrideSystemPrompt?: string | null
}): SystemPrompt {
  if (overrideSystemPrompt) {
    return asSystemPrompt([overrideSystemPrompt])
  }
  // Coordinator mode: use coordinator prompt instead of default.
  // Lazy require through shim to avoid circular dependency at module load time.
  if (
    feature('COORDINATOR_MODE') &&
    isEnvTruthy(readEnv('CLAUDE_CODE_COORDINATOR_MODE')) &&
    !mainThreadAgentDefinition
  ) {
    const { getCoordinatorSystemPrompt } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@claude-code/agent/coordinatorMode.js') as typeof import('@claude-code/agent/coordinatorMode.js')
    return asSystemPrompt([
      getCoordinatorSystemPrompt(),
      ...(appendSystemPrompt ? [appendSystemPrompt] : []),
    ])
  }

  const agentSystemPrompt = mainThreadAgentDefinition
    ? isBuiltInAgent(mainThreadAgentDefinition)
      ? mainThreadAgentDefinition.getSystemPrompt({
          toolUseContext: { options: toolUseContext.options },
        })
      : mainThreadAgentDefinition.getSystemPrompt()
    : undefined

  // Log agent memory loaded event for main loop agents
  if (mainThreadAgentDefinition?.memory) {
    logEvent('tengu_agent_memory_loaded', {
      ...(readEnv('USER_TYPE') === 'ant' && {
        agent_type:
          mainThreadAgentDefinition.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      scope:
        mainThreadAgentDefinition.memory as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source:
        'main-thread' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // In proactive mode, agent instructions are appended to the default prompt
  // rather than replacing it. The proactive default prompt is already lean
  // (autonomous agent identity + memory + env + proactive section), and agents
  // add domain-specific behavior on top — same pattern as teammates.
  if (
    agentSystemPrompt &&
    (feature('PROACTIVE') || feature('KAIROS')) &&
    isProactiveActive_SAFE_TO_CALL_ANYWHERE()
  ) {
    return asSystemPrompt([
      ...defaultSystemPrompt,
      `\n# Custom Agent Instructions\n${agentSystemPrompt}`,
      ...(appendSystemPrompt ? [appendSystemPrompt] : []),
    ])
  }

  return asSystemPrompt([
    ...(agentSystemPrompt
      ? [agentSystemPrompt]
      : customSystemPrompt
        ? [customSystemPrompt]
        : defaultSystemPrompt),
    ...(appendSystemPrompt ? [appendSystemPrompt] : []),
  ])
}
