/**
 * Telemetry hooks for runAgent — mirrors ant 4656.js subagent attribution.
 *
 * Extracted from runAgent.ts to keep that file under its file-size budget.
 *
 * @dynamicRequire
 */
import type { UUID } from 'crypto'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { logEvent } from '@claude-code/local-observability'
import { getSessionId } from '@claude-code/app-host/bootstrap/state.js'
import type { Message } from '@claude-code/agent/messageShapes'
import type { ReplHydration } from '@claude-code/agent/replHydration.js'
import type { AgentId } from '@claude-code/agent/idTypes'

interface MaybeRecordForkArgs {
  forkContextMessages: readonly Message[] | undefined
  contextMessages: readonly Message[]
  toolUseContext: { messages: readonly Message[]; agentId?: string }
  agentId: AgentId
}

export async function maybeRecordForkContextRef(
  a: MaybeRecordForkArgs,
): Promise<void> {
  if (
    a.forkContextMessages === undefined ||
    a.forkContextMessages !== a.toolUseContext.messages ||
    a.toolUseContext.agentId !== undefined
  ) return
  const parentLastUuid = a.forkContextMessages.at(-1)?.uuid
  if (parentLastUuid === undefined) return
  const { recordForkContextRef } = await import(
    '@claude-code/storage/sessionStorage.js'
  )
  void recordForkContextRef({
    agentId: a.agentId,
    parentSessionId: getSessionId() as UUID,
    parentLastUuid: parentLastUuid as UUID,
    contextLength: a.contextMessages.length,
  }).catch(_err =>
    logForDebugging(`Failed to record fork-context-ref: ${_err}`),
  )
}

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
