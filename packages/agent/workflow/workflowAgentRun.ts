// One subagent attempt for the workflow engine — extracted from hooks.ts so
// that file stays a thin hook ASSEMBLER and the (large, self-contained) agent
// execution lives on its own. Port of ant 2.1.150 3886's per-attempt `S` body:
// drive ccb's runAgent for one turn-loop, with a stall watchdog, progress
// emission, skip/retry/kill wiring, and worktree-scoped cwd.
//
// The retry/throttle ORCHESTRATION (how many attempts, when to back off) stays
// in hooks.ts execAgent; this module is a single attempt.

import { createUserMessage } from '../messages.js'
import { runAgent } from '@claude-code/tool-registry/tools/AgentTool/runAgent.js'
import { runWithCwdOverride } from '@claude-code/app-host/bootstrap/cwd.js'
import type { ToolUseContext, Tools } from '@claude-code/tool-registry/Tool.js'
import type { CanUseToolFn } from '@claude-code/repl/hooks/useCanUseTool.js'
import type { ModelAlias } from '@claude-code/provider/modelAliases.js'
import type { AgentDefinition } from '@claude-code/tool-registry/tools/AgentTool/loadAgentsDir.js'
import { createAgentId } from '../uuid.js'
import type {
  AgentExecResult,
  AgentHookOpts,
  WorkflowProgressEvent,
} from './types.js'
import { logOTelEvent } from '@claude-code/local-observability/telemetry'

// The slice of createWorkflowHooks' closure a single attempt needs. Passed once
// per attempt rather than recaptured — keeps the function pure-ish + testable.
export type AgentRunContext = {
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  onProgress: (e: WorkflowProgressEvent) => void
  workflowRunId: string
  workflowName: string
  abortSignal: AbortSignal | undefined
  onAgentController?: (
    agentId: string,
    controller: AbortController | null,
  ) => void
}

export type AgentAttemptParams = {
  index: number
  prompt: string
  label: string
  phaseTitle: string | undefined
  phaseIndex: number | undefined
  stallMs: number
  opts: AgentHookOpts | undefined
  agentDef: AgentDefinition
  availableTools: Tools
  hasSchema: boolean
  onAgentId: (agentId: string) => void
  priorDurationMs: number
  worktreePath?: string
}

// ant 3886 `S` — run one subagent attempt with stall detection, driving ccb's
// runAgent.
export async function runAgentAttempt(
  params: AgentAttemptParams,
  ctx: AgentRunContext,
): Promise<AgentExecResult> {
  const {
    index,
    prompt,
    label,
    phaseTitle,
    phaseIndex,
    stallMs,
    opts,
    agentDef,
    availableTools,
    onAgentId,
    priorDurationMs,
    worktreePath,
  } = params
  const {
    toolUseContext,
    canUseTool,
    onProgress,
    workflowRunId,
    workflowName,
    abortSignal,
    onAgentController,
  } = ctx

  const agentId = createAgentId()
  onAgentId(agentId)

  const startedAt = Date.now()
  let tokens = 0
  let toolCalls = 0
  let structured: unknown
  let lastText = ''
  let outputTokens: number | undefined
  let stopReason: string | null = null

  const model = opts?.model ?? toolUseContext.options.mainLoopModel
  const emit = (
    state: 'start' | 'progress' | 'done' | 'error',
    extra?: Record<string, unknown>,
  ): void => {
    onProgress({
      type: 'progress',
      toolUseID: `workflow_agent_${index}_${agentId}`,
      data: {
        type: 'workflow_agent',
        index,
        label,
        phaseIndex,
        phaseTitle,
        agentId: agentId as string,
        agentType: agentDef.agentType,
        isolation: opts?.isolation === 'worktree' ? 'worktree' : undefined,
        model,
        state,
        startedAt,
        lastProgressAt: Date.now(),
        ...extra,
      },
    })
  }

  // Per-attempt abort controller wired to skip/retry/kill via onAgentController
  // and the workflow's own abort signal.
  const attemptController = new AbortController()
  const onParentAbort = (): void => attemptController.abort('workflow-abort')
  abortSignal?.addEventListener('abort', onParentAbort)
  if (abortSignal?.aborted) attemptController.abort('workflow-abort')
  onAgentController?.(agentId, attemptController)

  // Stall watchdog: abort if no query progress for stallMs.
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  const armStall = (): void => {
    if (stallTimer) clearTimeout(stallTimer)
    if (stallMs > 0) {
      stallTimer = setTimeout(() => attemptController.abort('stalled'), stallMs)
    }
  }

  emit('start', priorDurationMs ? { durationMs: priorDurationMs } : undefined)
  armStall()

  const agentToolUseContext: ToolUseContext = {
    ...toolUseContext,
    abortController: attemptController,
  }

  const startTime = Date.now()
  onAgentId(agentId)
  // ant: the subagent runs with getCwd() pinned to the worktree. runAgent
  // resolves cwd via AsyncLocalStorage captured at generator-construction time
  // (runWithCwdOverride), so building the generator inside the override makes
  // every await in the loop see the worktree path. No-op without a worktree.
  const makeStream = () =>
    runAgent({
      agentDefinition: agentDef,
      promptMessages: [createUserMessage({ content: prompt })],
      toolUseContext: agentToolUseContext,
      canUseTool,
      isAsync: true,
      querySource: 'agent:workflow',
      availableTools,
      override: { agentId, abortController: attemptController },
      model: opts?.model as ModelAlias | undefined,
      transcriptSubdir: `workflows/${workflowRunId}`,
      ...(worktreePath && { worktreePath }),
      onQueryProgress: () => {
        armStall()
        emit('progress', { tokens, toolCalls })
      },
    })
  try {
    const stream = worktreePath
      ? runWithCwdOverride(worktreePath, makeStream)
      : makeStream()
    for await (const message of stream) {
      if (attemptController.signal.aborted) break
      if (message.type === 'attachment') {
        const att = (message as { attachment: { type: string; data?: unknown } })
          .attachment
        if (att.type === 'structured_output') {
          structured = att.data
        }
        continue
      }
      if (message.type === 'assistant') {
        const am = message as {
          message: {
            content: Array<{ type: string; text?: string; name?: string }>
            usage?: { output_tokens?: number }
            stop_reason?: string | null
          }
        }
        let textPart = ''
        let calls = 0
        for (const block of am.message.content) {
          if (block.type === 'text' && block.text) textPart += block.text
          if (block.type === 'tool_use') calls++
        }
        if (textPart) lastText = textPart
        toolCalls += calls
        stopReason = am.message.stop_reason ?? null
        outputTokens = am.message.usage?.output_tokens ?? outputTokens
        if (typeof outputTokens === 'number') tokens = outputTokens
        if (calls > 0) {
          if (stallTimer) clearTimeout(stallTimer)
          stallTimer = undefined
        }
        emit('progress', { tokens, toolCalls })
      }
    }
  } catch (e) {
    const reason = attemptController.signal.aborted
      ? attemptController.signal.reason
      : undefined
    if (reason === 'stalled' || reason === 'user-retry') {
      emit('error', {
        error:
          reason === 'stalled'
            ? `stalled — no progress for ${stallMs}ms`
            : 'retry requested by user',
        tokens,
        toolCalls,
        durationMs: priorDurationMs + (Date.now() - startTime),
      })
      return {
        structured: reason === 'stalled' ? structured : undefined,
        text: '',
        tokens,
        toolCalls,
        stalled: true,
        stalledReason: typeof reason === 'string' ? reason : 'stalled',
        skipped: false,
        durationMs: Date.now() - startTime,
        outputTokens,
      }
    }
    if (reason === 'user-skip') {
      emit('error', {
        error: 'skipped by user',
        tokens,
        toolCalls,
        durationMs: priorDurationMs + (Date.now() - startTime),
      })
      return {
        text: '',
        tokens,
        toolCalls,
        stalled: false,
        skipped: true,
        durationMs: Date.now() - startTime,
        outputTokens,
      }
    }
    emit('error', {
      error: e instanceof Error ? e.message : String(e),
      tokens,
      toolCalls,
      durationMs: priorDurationMs + (Date.now() - startTime),
    })
    throw e
  } finally {
    if (stallTimer) clearTimeout(stallTimer)
    abortSignal?.removeEventListener('abort', onParentAbort)
    onAgentController?.(agentId, null)
  }

  const durationMs = Date.now() - startTime
  void logOTelEvent('workflow_agent_completed', {
    'workflow.run_id': workflowRunId,
    'workflow.name': workflowName,
    duration_ms: String(durationMs),
    total_tokens: String(tokens),
    total_tool_uses: String(toolCalls),
  })
  emit('done', { tokens, toolCalls, durationMs: priorDurationMs + durationMs })
  return {
    structured,
    text: lastText,
    tokens,
    toolCalls,
    stalled: false,
    skipped: false,
    durationMs,
    outputTokens,
    stopReason,
  }
}
