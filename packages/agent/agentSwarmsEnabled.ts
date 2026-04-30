import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'

/**
 * Centralized runtime check for agent teams/teammate features.
 * This is the single gate that should be checked everywhere teammates
 * are referenced (prompts, code, tools isEnabled, UI, etc.).
 *
 * Swarm is a first-class ccb feature: no env opt-in, no CLI flag,
 * no USER_TYPE branching. The only remaining gate is the GrowthBook
 * killswitch (`tengu_amber_flint`, default true) so a remote
 * disable is possible if a critical bug ships. Default is ON.
 *
 * Historical: this used to short-circuit on `USER_TYPE === 'ant'`
 * for Anthropic-internal builds, plus require an
 * `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env var or `--agent-teams`
 * CLI flag for external builds. Both gates are removed for ccb's
 * single-operator self-hosted model — see plan
 * `reactive-honking-dusk.md` Phase W1.
 */
export function isAgentSwarmsEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_flint', true)
}
