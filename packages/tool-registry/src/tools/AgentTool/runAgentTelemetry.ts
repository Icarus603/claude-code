/**
 * Telemetry hooks for runAgent — mirrors ant 4656.js subagent attribution.
 *
 * Extracted from runAgent.ts to keep that file under its file-size budget.
 *
 * @dynamicRequire
 */
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { logEvent } from '@claude-code/local-observability'
import type { ReplHydration } from '@claude-code/agent/replHydration.js'

export function emitReplHydrationTelemetry(
  rh: ReplHydration,
  agentId: string,
  agentType: string,
): void {
  logForDebugging(
    `[runAgent] replHydration kind=${rh.kind} agentId=${agentId} entries=${rh.log.length}`,
  )
  logEvent('tengu_subagent_repl_hydration', {
    kind: rh.kind,
    agent_type: agentType,
    entries: String(rh.log.length),
  })
}

export function emitSpawnedBySkillTelemetry(
  spawnedBySkill: string,
  agentType: string,
  isBuiltIn: boolean,
): void {
  logEvent('tengu_subagent_skill_attribution', {
    skill_name: spawnedBySkill,
    agent_type: agentType,
    is_built_in: String(isBuiltIn),
  })
}
