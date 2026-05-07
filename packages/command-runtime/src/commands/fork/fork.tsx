/**
 * `/fork <directive>` execute body.
 *
 * Mirrors ant v2.1.131 4657.js (Zf3) + 4656.js (mJK):
 *   1. Resolve parent's renderedSystemPrompt (or rebuild if missing).
 *   2. Generate a stable agentId + a short slug from the directive.
 *   3. Register the fork in AppState.tasks via `registerAsyncAgent` so the
 *      tasks panel / swarm dashboard sees it.
 *   4. Wrap the spawn in `runWithAgentContext` for analytics attribution.
 *   5. Fire-and-forget: hand off to `runAsyncAgentLifecycle` which drives
 *      the agent loop, persists messages, and enqueues a task-notification
 *      message back to the parent REPL when the fork terminates.
 *
 * Same primitives as AgentTool's fork-subagent path (subagent_type omitted
 * with `FORK_SUBAGENT` on); the slash-command form is just a thin wrapper
 * that always uses FORK_AGENT and never blocks the caller.
 */

import { feature } from 'bun:bundle'
import type { Message as MessageType } from '@claude-code/agent/messageShapes'
import { createUserMessage } from '@claude-code/agent/messages.js'
import { asAgentId, type AgentId } from '@claude-code/agent/idTypes'
import { createAgentId } from '@claude-code/agent/uuid.js'
import { runWithAgentContext } from '@claude-code/agent/agentContext.js'
import { registerAsyncAgent } from '@claude-code/agent/localAgentTask.js'
import { getSystemPrompt } from '@claude-code/agent/prompts.js'
import { buildEffectiveSystemPrompt } from '@claude-code/provider/systemPrompt.js'
import { runWithCwdOverride } from '@claude-code/app-host/bootstrap/cwd.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import {
  FORK_AGENT,
  buildChildMessage,
  isInForkChild,
} from '@claude-code/tool-registry/tools/AgentTool/forkSubagent.js'
import { runAsyncAgentLifecycle } from '@claude-code/tool-registry/tools/AgentTool/agentToolUtils.js'
import { runAgent } from '@claude-code/tool-registry/tools/AgentTool/runAgent.js'
import { getParentSessionId } from '@claude-code/swarm/teammateState.js'
import {
  type LocalJSXCommandCall,
  type LocalJSXCommandContext,
} from '../../types.js'

const FORK_DIRECTIVE_MAX_LENGTH = 50

/**
 * Mirror of ant 4656.js Gf3 — slug from first 3 words of directive.
 * Stable, kebab-case, lowercase, max 24 chars, fallback "fork".
 *
 * Exported for unit-test coverage.
 *
 * @dynamicRequire
 */
export function deriveForkSlug(directive: string): string {
  return (
    directive
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'fork'
  )
}

/**
 * Slash commands receive a LocalJSXCommandContext that carries the
 * parent's toolUseContext + canUseTool fn through the [key:string]:unknown
 * escape hatch (see LocalJSXCommandContext type def). Pull them out with
 * a structurally-typed helper — ToolUseContext lives in tool-registry and
 * static-importing it here is fine (cmd-runtime already depends on
 * tool-registry through promptShellExecution and insights).
 */
type ForkCommandContext = LocalJSXCommandContext & {
  toolUseContext: Parameters<typeof runAgent>[0]['toolUseContext']
  canUseTool?: Parameters<typeof runAgent>[0]['canUseTool']
}

export const call: LocalJSXCommandCall = async (onDone, rawContext, args) => {
  const directive = args.trim()
  if (!directive) {
    onDone('Usage: /fork <directive>', { display: 'system' })
    return null
  }

  if (!feature('FORK_SUBAGENT')) {
    onDone('Fork subagent is not enabled in this build.', { display: 'system' })
    return null
  }

  const context = rawContext as ForkCommandContext
  const toolUseContext = context.toolUseContext
  if (!toolUseContext) {
    onDone(
      'Fork is not available — this command must run inside an active REPL session.',
      { display: 'system' },
    )
    return null
  }

  // Recursive fork guard — same check as AgentTool fork path.
  if (
    toolUseContext.options.querySource === `agent:builtin:${FORK_AGENT.agentType}` ||
    isInForkChild(toolUseContext.messages as MessageType[])
  ) {
    // ant 3692.js — recursive-fork telemetry on the slash-command path too.
    logEvent('tengu_subagent_launch', {
      action: 'failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      reason: 'subagent_recursive_fork' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    onDone(
      'Fork is not available inside a forked worker. Complete your task directly using your tools.',
      { display: 'system' },
    )
    return null
  }

  // Need at least one prior conversation turn for the fork to inherit
  // meaningful context; ant 4657.js returns null with the same wording.
  if (toolUseContext.messages.length === 0) {
    // ant 4656.js Wf3 fall-through: empty messages means no parent
    // prompt to inherit — match ant `subagent_fork_prompt_missing`.
    logEvent('tengu_subagent_launch', {
      action: 'failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      reason: 'subagent_fork_prompt_missing' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    onDone('Cannot fork before the first conversation turn', {
      display: 'system',
    })
    return null
  }

  const slug = deriveForkSlug(directive)
  const description =
    directive.length > FORK_DIRECTIVE_MAX_LENGTH
      ? directive.slice(0, FORK_DIRECTIVE_MAX_LENGTH - 1) + '…'
      : directive

  const agentId = createAgentId(slug)
  const setAppState = toolUseContext.setAppState

  // Resolve parent's rendered system prompt (byte-identical for cache hits)
  // or rebuild via buildEffectiveSystemPrompt as a fallback. Mirrors
  // AgentTool's isForkPath branch.
  const renderedSystemPrompt = (
    toolUseContext as { renderedSystemPrompt?: ReturnType<typeof buildEffectiveSystemPrompt> }
  ).renderedSystemPrompt
  const appState = toolUseContext.getAppState()
  let forkParentSystemPrompt: ReturnType<typeof buildEffectiveSystemPrompt>
  if (renderedSystemPrompt) {
    forkParentSystemPrompt = renderedSystemPrompt
  } else {
    // appState comes back as the V7 §7.2 partial shim
    // (`Record<string, any>`), so the typed-Map.keys() iterator collapses
    // to IterableIterator<unknown>. Re-narrow at the read site to match
    // getSystemPrompt's `string[]` parameter.
    const narrowedAppState = appState as {
      agent?: string
      toolPermissionContext: {
        additionalWorkingDirectories: ReadonlyMap<string, unknown>
      }
    }
    const awdMap =
      narrowedAppState.toolPermissionContext.additionalWorkingDirectories
    const additionalWorkingDirectories = Array.from(awdMap.keys())
    // If the user is in a custom-agent context (e.g. /agent helper),
    // resolve the matching definition so the fork inherits the agent's
    // system prompt rather than falling back to the default Claude Code
    // prompt. Mirrors ant 4656.js Wf3.
    const activeAgentName = narrowedAppState.agent
    const mainThreadAgentDefinition = activeAgentName
      ? toolUseContext.options.agentDefinitions?.activeAgents.find(
          a => a.agentType === activeAgentName,
        )
      : undefined
    const defaultSystemPrompt = await getSystemPrompt(
      toolUseContext.options.tools,
      toolUseContext.options.mainLoopModel,
      additionalWorkingDirectories,
      toolUseContext.options.mcpClients,
    )
    forkParentSystemPrompt = buildEffectiveSystemPrompt({
      mainThreadAgentDefinition,
      toolUseContext,
      customSystemPrompt: toolUseContext.options.customSystemPrompt,
      defaultSystemPrompt,
      appendSystemPrompt: toolUseContext.options.appendSystemPrompt,
    })
  }

  // Slash-command-form fork: a single user message with the buildChildMessage
  // boilerplate + directive. AgentTool's fork uses buildForkedMessages which
  // clones the parent's last assistant turn for prompt-cache hit alignment;
  // that's only useful when the spawn happens mid-turn (i.e. via Agent tool
  // with subagent_type omitted). From a slash command there is no parent
  // assistant turn to mirror — the child agent's context comes purely from
  // forkContextMessages.
  const promptMessages: MessageType[] = [
    createUserMessage({
      content: buildChildMessage(directive),
    }),
  ]

  const canUseTool = context.canUseTool
  if (!canUseTool) {
    onDone(
      'Fork is not available — REPL host did not provide a canUseTool binding. This is a bug in the slash-command dispatch wiring.',
      { display: 'system' },
    )
    return null
  }

  const agentBackgroundTask = registerAsyncAgent({
    agentId,
    description,
    prompt: directive,
    selectedAgent: FORK_AGENT,
    setAppState,
    toolUseId: undefined,
  })

  // Register slug → agentId in the name registry so the tasks panel /
  // CoordinatorAgentStatus / SendMessage routing can address this fork
  // by its slug (e.g. "find-bug" → 8a3b...). Mirrors AgentTool's
  // registration path (AgentTool.tsx:972-978) and ant 4656.js mJK
  // line 53 (`agentLifecycle.registerName(T, QT(z))`).
  setAppState((prev: { agentNameRegistry?: Map<string, AgentId> }) => {
    const existing = prev.agentNameRegistry
    if (!(existing instanceof Map)) return prev
    const next = new Map(existing)
    next.set(slug, asAgentId(agentBackgroundTask.agentId))
    return { ...prev, agentNameRegistry: next }
  })

  // ant 4656.js:71 — capture parent agent id (nested-fork chain).
  const { getAgentContext } = await import('@claude-code/agent/agentContext.js')
  const parentAgentId = getAgentContext()?.agentId
  const asyncAgentContext = {
    agentId,
    parentSessionId: getParentSessionId(),
    parentAgentId,
    agentType: 'subagent' as const,
    subagentName: FORK_AGENT.agentType,
    isBuiltIn: true,
    invocationKind: 'spawn' as const,
    invocationEmitted: false,
  }

  const metadata = {
    prompt: directive,
    resolvedAgentModel: toolUseContext.options.mainLoopModel,
    isBuiltInAgent: true,
    startTime: Date.now(),
    agentType: FORK_AGENT.agentType,
    isAsync: true,
  }

  // ant 4656.js mJK lines 29-37 — pre-compute replHydration log so
  // it's available synchronously when runAgent is invoked.
  const { reconstructLog } = await import(
    '@claude-code/agent/replHydration.js'
  )
  const forkReplLog = reconstructLog(toolUseContext.messages as MessageType[])

  // Fire-and-forget. runWithAgentContext threads the analytics context,
  // runWithCwdOverride preserves cwd if the parent had one. Errors during
  // the lifecycle are surfaced inside the lifecycle (task notification
  // with status=failed) — we don't await the promise.
  void runWithAgentContext(asyncAgentContext, () =>
    runWithCwdOverride(undefined, () =>
      runAsyncAgentLifecycle({
        taskId: agentBackgroundTask.agentId,
        abortController: agentBackgroundTask.abortController!,
        makeStream: onCacheSafeParams =>
          runAgent({
            agentDefinition: FORK_AGENT,
            promptMessages,
            toolUseContext,
            canUseTool,
            isAsync: true,
            forkContextMessages: toolUseContext.messages as MessageType[],
            querySource: `agent:builtin:${FORK_AGENT.agentType}`,
            override: {
              systemPrompt: forkParentSystemPrompt,
              agentId: asAgentId(agentBackgroundTask.agentId),
              abortController: agentBackgroundTask.abortController!,
              replHydration: {
                kind: 'fork' as const,
                log: forkReplLog,
              },
            },
            availableTools: toolUseContext.options.tools,
            useExactTools: true,
            onCacheSafeParams,
            description,
            // ant 4656.js:92 — propagate skill attribution.
            spawnedBySkill:
              toolUseContext.options.spawnedBySkill ??
              toolUseContext.options.activeSkill,
            // ant 4656.js:105 / 3930.js:313 — symbolic agent name.
            name: slug,
          }),
        metadata,
        description,
        toolUseContext,
        rootSetAppState: setAppState,
        agentIdForCleanup: agentBackgroundTask.agentId,
        enableSummarization: true,
        getWorktreeResult: async () => ({}),
      }),
    ),
  ).catch((error: unknown) => {
    logForDebugging(`[fork] runAsyncAgentLifecycle failed: ${String(error)}`)
  })

  logEvent('tengu_subagent_launch', {
    source: 'slash-fork' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    agent_type: FORK_AGENT.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  onDone(
    `🍴 forked ${slug} (${agentBackgroundTask.agentId.slice(-4)})`,
    { display: 'system' },
  )
  return null
}
