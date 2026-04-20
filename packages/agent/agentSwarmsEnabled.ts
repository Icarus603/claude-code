import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { isEnvTruthy, readEnv } from '@claude-code/config/env/utils'

function isAgentTeamsFlagSet(): boolean {
  return process.argv.includes('--agent-teams')
}

/**
 * Centralized runtime check for agent teams/teammate features.
 * This is the single gate that should be checked everywhere teammates
 * are referenced (prompts, code, tools isEnabled, UI, etc.).
 *
 * Ant builds: always enabled.
 * External builds require both:
 * 1. Opt-in via CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var OR --agent-teams flag
 * 2. GrowthBook gate 'tengu_amber_flint' enabled (killswitch)
 */
export function isAgentSwarmsEnabled(): boolean {
  if (readEnv('USER_TYPE') === 'ant') {
    return true
  }

  if (
    !isEnvTruthy(readEnv('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')) &&
    !isAgentTeamsFlagSet()
  ) {
    return false
  }

  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_flint', true)) {
    return false
  }

  return true
}
