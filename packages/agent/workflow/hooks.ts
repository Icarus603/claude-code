// Workflow hook factory — port of ant 2.1.150 module Gb8 (3886.js), the engine
// core. Builds the script-facing hooks: agent() / parallel() / pipeline() /
// phase() / log(), with the concurrency cap, the 1000-agent backstop, the
// shared token-budget ceiling, journal-cached resume, phase grouping, agent
// stall detection + retry + throttle backoff, and schema → StructuredOutput
// forcing.
//
// ant drove a raw query loop (Lh) inside the agent executor. ccb already wraps
// query() in runAgent() (AgentTool/runAgent.ts) — which handles transcript
// recording, structured_output attachments, subagent hooks, and worktree
// transcript routing — so the executor here drives runAgent() and consumes its
// yielded Messages. The control flow (caps, cache, stall/retry/throttle) mirrors
// ant exactly; only the innermost "spawn one subagent" call differs.

import { availableParallelism } from 'node:os'
import type { ToolUseContext, Tools } from '@claude-code/tool-registry/Tool.js'
import type { CanUseToolFn } from '@claude-code/repl/hooks/useCanUseTool.js'
import type { AgentId } from '@claude-code/agent/idTypes'
import type { ModelAlias } from '@claude-code/provider/modelAliases.js'
import { createAgentId } from '../uuid.js'
import { createUserMessage } from '../messages.js'
import { runAgent } from '@claude-code/tool-registry/tools/AgentTool/runAgent.js'
import {
  createSyntheticOutputTool,
  SYNTHETIC_OUTPUT_TOOL_NAME,
} from '@claude-code/tool-registry/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import type {
  AgentDefinition,
  BuiltInAgentDefinition,
} from '@claude-code/tool-registry/tools/AgentTool/loadAgentsDir.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { stripPrototype } from './sandbox.js'
import { computeAgentCacheKey } from './journal.js'
import type {
  AgentHookOpts,
  FrozenBudget,
  JournalState,
  TokenBudget,
  WorkflowHooks,
  WorkflowJournal,
  WorkflowPhaseMeta,
  WorkflowProgressEvent,
} from './types.js'

// ant cj3 — concurrency cap. Not enforced as a hard semaphore here (parallel/
// pipeline accept any count); kept as the advertised default for docs/telemetry
// parity. ant: min(16, max(2, cpus-2)).
export function workflowConcurrencyCap(): number {
  const cpus = availableParallelism()
  return Math.min(16, Math.max(2, cpus - 2))
}

// ant KHK — total agent() count backstop across a workflow's lifetime.
const AGENT_COUNT_CAP = 1000
// ant ej3 — default per-agent stall timeout (no progress → abort + retry).
const DEFAULT_STALL_MS = 180_000
// ant _HK — max stall retries before giving up on an agent.
const MAX_STALL_RETRIES = 5
// ant — narrator log lines retained (the engine caps total to avoid unbounded
// growth; the task-state batcher trims further).
const MAX_LOG_LINES = 1000

// Thrown when the agent-count backstop trips.
class AgentCountCapError extends Error {
  constructor(count: number) {
    super(
      `Workflow exceeded the ${AGENT_COUNT_CAP}-agent lifetime cap (spawned ${count}). This is a runaway-loop backstop.`,
    )
    this.name = 'AgentCountCapError'
  }
}

// Thrown when the shared token budget is exhausted. parallel()/pipeline()
// convert this to a dropped (null) slot rather than failing the whole call.
export class BudgetExceededError extends Error {
  constructor(spent: number, total: number) {
    super(`Token budget exhausted: spent ${spent} of ${total}.`)
    this.name = 'BudgetExceededError'
  }
}

// ant rj3 — system-prompt addendum for the default workflow subagent: its final
// text IS the return value, not a human-facing message.
const WORKFLOW_SUBAGENT_PROMPT = `You are a subagent spawned by a workflow orchestration script. Use the tools available to complete the task.

CRITICAL: Your final text response is returned **verbatim** as a string to the calling script — it is your return value, not a message to a human.
- Output the literal result (data, JSON, text). Do NOT output confirmations like "Done." or "Sent."
- If asked for JSON, return ONLY the raw JSON — no code fences, no prose, no markdown.
- Do NOT use SendMessage to deliver your answer. Put your answer in your final text response.
- Be concise. The script will parse your output.`

// ant oj3 — appended to a CUSTOM agent's own system prompt when used via
// agent({agentType}) so it still returns its text verbatim.
const WORKFLOW_SUBAGENT_PROMPT_SUFFIX = `

---

NOTE: You are running inside a workflow script. Your final text response is returned verbatim as a string to the calling script — it is your return value, not a message to a human. Output the literal result; do not output confirmations like "Done." Be concise — the script will parse your output.`

// The default workflow subagent definition (ant Rb8). Built-in, full tool
// access, verbatim-return system prompt.
function defaultWorkflowAgent(): BuiltInAgentDefinition {
  return {
    agentType: 'workflow',
    source: 'built-in',
    baseDir: 'built-in',
    whenToUse: 'Subagent spawned by a workflow orchestration script.',
    tools: ['*'],
    getSystemPrompt: () => WORKFLOW_SUBAGENT_PROMPT,
  }
}

type AgentExecResult = {
  structured?: unknown
  text: string
  tokens: number
  toolCalls: number
  stalled: boolean
  stalledReason?: string
  skipped: boolean
  durationMs: number
  outputTokens?: number
  // Last assistant message's stop_reason — null when the turn ended without
  // one (the throttle signal: ant 3886 `aH` treats stopReason==null + tiny
  // output + long duration as a throttled/empty response).
  stopReason?: string | null
}

/**
 * Abort-aware sleep — ant 3886 `r6(ms, signal, {throwOnAbort:true})`. Resolves
 * after `ms`, or rejects immediately if `signal` aborts (so a workflow abort
 * during the throttle cooldown propagates instead of waiting out the 45s).
 */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Workflow aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('Workflow aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * ant THK — build the workflow hooks bundle for one run.
 *
 * @param toolUseContext  the host tool-use context (provides options, AppState, abort)
 * @param canUseTool      permission gate passed to subagents
 * @param onProgress      progress-event sink (batched into task state)
 * @param workflowRunId   used as the transcript subdir base (workflows/<runId>)
 * @param onAgentController register/deregister an agent's AbortController (for skip/retry/kill)
 * @param seedPhaseTitles  meta.phases titles to pre-seed the phase display order
 * @param tokenBudget     shared turn budget
 * @param journal         resume journal (optional)
 * @param journalState    pre-loaded journal index (optional)
 */
export function createWorkflowHooks(
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  onProgress: (e: WorkflowProgressEvent) => void,
  workflowRunId: string,
  onAgentController:
    | ((agentId: string, controller: AbortController | null) => void)
    | undefined,
  seedPhaseTitles: string[] | undefined,
  tokenBudget: TokenBudget | undefined,
  budget: FrozenBudget,
  journal: WorkflowJournal | undefined,
  journalState: JournalState | undefined,
): WorkflowHooks {
  let agentCount = 0
  let vmAwait: (v: unknown) => Promise<unknown> = async v => v
  let journalCacheHitPrefix = '' // running concat of cache keys (resume prefix)
  let prefixDiverged = false
  const failures: string[] = []
  let agentCapTripped = false
  let budgetCapTripped = false

  const abortSignal = toolUseContext.abortController?.signal

  function checkAgentCap(): void {
    if (agentCount < AGENT_COUNT_CAP) return
    if (!agentCapTripped) agentCapTripped = true
    throw new AgentCountCapError(agentCount)
  }

  function checkBudget(): void {
    if (tokenBudget?.total == null || tokenBudget.total <= 0) return
    const spent = tokenBudget.getTurnSpent()
    if (spent < tokenBudget.total) return
    if (!budgetCapTripped) budgetCapTripped = true
    throw new BudgetExceededError(spent, tokenBudget.total)
  }

  // ── phase grouping ──
  let phaseCounter = 0
  let currentPhaseTitle: string | undefined
  const phaseIndexByTitle = new Map<string, number>()

  function resolvePhase(title: string, kind?: 'child'): number {
    let idx = phaseIndexByTitle.get(title)
    if (idx == null) {
      idx = ++phaseCounter
      phaseIndexByTitle.set(title, idx)
      onProgress({
        type: 'progress',
        toolUseID: `workflow_phase_${idx}`,
        data: { type: 'workflow_phase', index: idx, title, kind },
      })
    }
    return idx
  }
  for (const t of seedPhaseTitles ?? []) resolvePhase(t)

  const phase = stripPrototype((title: string): void => {
    currentPhaseTitle = String(title)
    resolvePhase(currentPhaseTitle)
  })

  const log = stripPrototype((message: string): void => {
    onProgress({
      type: 'progress',
      toolUseID: 'workflow_log',
      data: { type: 'workflow_log', message: String(message) },
    })
  })

  // ── agent() ──
  const agent = stripPrototype(
    async (prompt: string, opts?: AgentHookOpts): Promise<unknown> => {
      if (abortSignal?.aborted) throw new Error('Workflow aborted')
      checkAgentCap()
      checkBudget()

      const index = ++agentCount
      const promptStr = String(prompt)
      const label =
        opts?.label != null
          ? String(opts.label)
          : promptStr.slice(0, 60).replace(/\s+/g, ' ').trim()
      const phaseTitle =
        opts?.phase != null ? String(opts.phase) : currentPhaseTitle
      const phaseIndex = phaseTitle != null ? resolvePhase(phaseTitle) : undefined
      const stallMs = opts?.stallMs != null ? Number(opts.stallMs) : DEFAULT_STALL_MS

      // ── resume cache lookup ──
      let cacheKey: string | undefined
      if (journal) {
        cacheKey = computeAgentCacheKey(promptStr, opts, journalCacheHitPrefix)
        journalCacheHitPrefix = cacheKey
        const cached = prefixDiverged
          ? undefined
          : journalState?.results.get(cacheKey)
        if (cached !== undefined) {
          onProgress({
            type: 'progress',
            toolUseID: `workflow_agent_${index}_cached`,
            data: {
              type: 'workflow_agent',
              index,
              label,
              phaseIndex,
              phaseTitle,
              agentId: cached.agentId,
              model: opts?.model ?? toolUseContext.options.mainLoopModel,
              state: 'done',
              startedAt: Date.now(),
              lastProgressAt: Date.now(),
            },
          })
          return cached.result
        }
        // First cache miss → everything after this point runs live.
        prefixDiverged = true
      }

      if (opts?.isolation === 'remote') {
        throw new Error(
          "agent({isolation:'remote'}) is not available in this build (no CCR backend).",
        )
      }

      let recordedAgentId = ''
      const appendStarted = (agentId: string): void => {
        recordedAgentId = agentId
        if (journal && cacheKey) {
          void journal
            .append({ type: 'started', key: cacheKey, agentId })
            .catch(e =>
              logForDebugging(`workflow journal started-append failed: ${e}`),
            )
        }
      }
      const appendResult = async (value: unknown): Promise<unknown> => {
        if (journal && cacheKey && value !== null) {
          await journal
            .append({
              type: 'result',
              key: cacheKey,
              agentId: recordedAgentId,
              result: value,
            })
            .catch(e =>
              logForDebugging(`workflow journal result-append failed: ${e}`),
            )
        }
        return value
      }

      const result = await execAgent(
        index,
        promptStr,
        label,
        phaseTitle,
        phaseIndex,
        stallMs,
        opts,
        appendStarted,
      )
      return appendResult(result)
    },
  )

  // ── agent executor (ant S) ──
  async function execAgent(
    index: number,
    prompt: string,
    label: string,
    phaseTitle: string | undefined,
    phaseIndex: number | undefined,
    stallMs: number,
    opts: AgentHookOpts | undefined,
    onAgentId: (agentId: string) => void,
  ): Promise<unknown> {
    if (abortSignal?.aborted) throw new Error('Workflow aborted')
    checkBudget()

    // Resolve the agent definition.
    const allAgents = toolUseContext.options.agentDefinitions.activeAgents
    let agentDef: AgentDefinition = defaultWorkflowAgent()
    if (opts?.agentType != null) {
      const requested = String(opts.agentType)
      const found = allAgents.find(a => a.agentType === requested)
      if (!found) {
        throw new Error(
          `agent({agentType}): agent type '${requested}' not found. Available: ${allAgents.map(a => a.agentType).join(', ')}`,
        )
      }
      // Append the verbatim-return note to the custom agent's own prompt.
      const basePrompt =
        'getSystemPrompt' in found
          ? (found as { getSystemPrompt: (p?: unknown) => string }).getSystemPrompt
          : () => ''
      agentDef = {
        ...found,
        getSystemPrompt: (p?: unknown) =>
          (basePrompt as (p?: unknown) => string)(p) +
          WORKFLOW_SUBAGENT_PROMPT_SUFFIX,
      } as AgentDefinition
    }

    // schema → force a StructuredOutput tool.
    let schemaTool: Tools[number] | undefined
    if (opts?.schema) {
      const built = createSyntheticOutputTool(opts.schema)
      if ('error' in built) {
        throw new TypeError(
          `agent({schema}) received an invalid JSON Schema: ${built.error}`,
        )
      }
      schemaTool = built.tool as Tools[number]
    }

    // Assemble the available tools. With a schema, append the StructuredOutput
    // tool; otherwise inherit the parent's tool set.
    const parentTools = toolUseContext.options.tools
    const availableTools: Tools = schemaTool
      ? [
          ...parentTools.filter(t => t.name !== SYNTHETIC_OUTPUT_TOOL_NAME),
          schemaTool,
        ]
      : parentTools

    const stallReasons: string[] = []
    let res = await runWithStall(
      index,
      prompt,
      label,
      phaseTitle,
      phaseIndex,
      stallMs,
      opts,
      agentDef,
      availableTools,
      !!schemaTool,
      onAgentId,
      0,
    )

    for (
      let retry = 1;
      res.stalled && retry <= MAX_STALL_RETRIES;
      retry++
    ) {
      if (abortSignal?.aborted) throw new Error('Workflow aborted')
      stallReasons.push(res.stalledReason ?? 'stalled')
      log(
        `[stall] agent "${label}" ${res.stalledReason ?? 'stalled'} after ${Math.round(res.durationMs / 1000)}s — retrying (${retry}/${MAX_STALL_RETRIES})`,
      )
      res = await runWithStall(
        index,
        prompt,
        `${label} (retry ${retry})`,
        phaseTitle,
        phaseIndex,
        stallMs,
        opts,
        agentDef,
        availableTools,
        !!schemaTool,
        onAgentId,
        res.durationMs,
      )
    }

    // Throttle backoff — ant 3886 `aH`/`r6(45000)`. A turn with no stop_reason,
    // no structured output, <50 output tokens, yet running >half the stall
    // window is a rate-limited/empty response, not real work. Sleep 45s + retry
    // once (ant parity); without it a throttled workflow burns the hard-stall
    // (180s) retries instead of cooling down.
    const isThrottled = (r: AgentExecResult): boolean =>
      !r.stalled &&
      !r.skipped &&
      (r.stopReason == null) &&
      r.structured === undefined &&
      (r.outputTokens ?? Infinity) < 50 &&
      r.durationMs > stallMs * 0.5
    if (isThrottled(res)) {
      log(
        `[throttle] agent "${label}" throttled response (no stop_reason, ${res.outputTokens ?? '?'} output tokens in ${Math.round(res.durationMs / 1000)}s) — sleeping 45s before retry`,
      )
      await sleepAbortable(45_000, abortSignal)
      res = await runWithStall(
        index,
        prompt,
        `${label} (throttle-retry)`,
        phaseTitle,
        phaseIndex,
        stallMs,
        opts,
        agentDef,
        availableTools,
        !!schemaTool,
        onAgentId,
        res.durationMs,
      )
      if (isThrottled(res)) {
        log(
          `[throttle] agent "${label}" still throttled after retry — continuing with partial result`,
        )
      }
    }

    if (res.skipped) return null
    if (res.stalled) {
      throw new Error(
        `agent stalled on all ${MAX_STALL_RETRIES + 1} attempts (no progress for ${stallMs}ms each)`,
      )
    }
    if (schemaTool) {
      if (res.structured === undefined) {
        throw new Error(
          'agent({schema}): subagent completed without calling StructuredOutput.',
        )
      }
      return res.structured
    }
    return res.text
  }

  // Run one subagent attempt with stall detection, driving ccb's runAgent.
  async function runWithStall(
    index: number,
    prompt: string,
    label: string,
    phaseTitle: string | undefined,
    phaseIndex: number | undefined,
    stallMs: number,
    opts: AgentHookOpts | undefined,
    agentDef: AgentDefinition,
    availableTools: Tools,
    hasSchema: boolean,
    onAgentId: (agentId: string) => void,
    priorDurationMs: number,
  ): Promise<AgentExecResult> {
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
        stallTimer = setTimeout(
          () => attemptController.abort('stalled'),
          stallMs,
        )
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
    try {
      for await (const message of runAgent({
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
        onQueryProgress: () => {
          armStall()
          emit('progress', { tokens, toolCalls })
        },
      })) {
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
          error: reason === 'stalled' ? `stalled — no progress for ${stallMs}ms` : 'retry requested by user',
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

  // ── parallel() — barrier ──
  const parallel = stripPrototype(
    async (thunks: Array<() => Promise<unknown>>): Promise<unknown[]> => {
      if (!Array.isArray(thunks)) {
        throw new TypeError('parallel() expects an array of functions')
      }
      if (thunks.length === 0) return []
      checkAgentCap()
      checkBudget()
      for (const t of thunks) {
        if (typeof t !== 'function') {
          throw new TypeError(
            'parallel() expects an array of functions, not promises. Wrap each call: () => agent(...)',
          )
        }
      }
      const settled = await Promise.allSettled(thunks.map(t => vmAwait(t())))
      let dropped = 0
      const out = settled.map((s, i) => {
        if (s.status === 'fulfilled') return s.value
        if (s.reason instanceof BudgetExceededError) {
          dropped++
          return null
        }
        const msg = `parallel[${i}] failed: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`
        failures.push(msg)
        log(msg)
        return null
      })
      if (dropped > 0) {
        failures.push(`parallel: ${dropped} slot(s) dropped — token budget exceeded`)
      }
      return out
    },
  )

  // ── pipeline() — no barrier, each item runs all stages independently ──
  const pipeline = stripPrototype(
    async (
      items: unknown[],
      ...stages: Array<
        (prev: unknown, item: unknown, index: number) => Promise<unknown> | unknown
      >
    ): Promise<unknown[]> => {
      if (!Array.isArray(items)) {
        throw new TypeError('pipeline() expects an array as the first argument')
      }
      if (items.length === 0) return []
      checkAgentCap()
      checkBudget()
      for (const s of stages) {
        if (typeof s !== 'function') {
          throw new TypeError(
            'pipeline() stages must be functions: pipeline(items, item => ..., result => ...)',
          )
        }
      }
      const settled = await Promise.allSettled(
        items.map(async (item, index) => {
          let acc: unknown = item
          for (const stage of stages) {
            if (acc === null) break
            acc = await vmAwait(stage(acc, item, index))
          }
          return acc
        }),
      )
      let dropped = 0
      const out = settled.map((s, i) => {
        if (s.status === 'fulfilled') return s.value
        if (s.reason instanceof BudgetExceededError) {
          dropped++
          return null
        }
        const msg = `pipeline[${i}] failed: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`
        failures.push(msg)
        log(msg)
        return null
      })
      if (dropped > 0) {
        failures.push(`pipeline: ${dropped} slot(s) dropped — token budget exceeded`)
      }
      return out
    },
  )

  void MAX_LOG_LINES
  void budget

  return {
    agent,
    parallel,
    pipeline,
    log,
    phase,
    resolvePhase,
    recordFailure: (msg: string) => {
      failures.push(msg)
    },
    getAgentCount: () => agentCount,
    getFailures: () => failures,
    bindVMAwait: (fn: (v: unknown) => Promise<unknown>) => {
      vmAwait = fn
    },
  }
}

export type { WorkflowPhaseMeta }
