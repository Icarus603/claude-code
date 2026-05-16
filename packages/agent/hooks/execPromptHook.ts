import { randomUUID } from 'crypto'
import type { HookEvent } from '@claude-code/headless-sdk/agentSdkTypes.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '@claude-code/local-observability'
import { queryModelWithoutStreaming } from '@claude-code/provider/claude.js'
import type { ToolUseContext } from '@claude-code/tool-registry/Tool.js'
import { has1mContext } from '../context.js'
import type { Message } from '../messageShapes'
import { SYNTHETIC_MODEL } from '../messages.js'
import { createAttachmentMessage } from '../attachments.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { errorMessage } from '@claude-code/local-observability/errorHelpers.js'
import type { HookResult } from '../hooks.js'
import { safeParseJSON } from '@claude-code/storage/json.js'
import { createUserMessage, extractTextContent } from '../messages.js'
import { getSmallFastModel } from '@claude-code/provider/model.js'
import type { PromptHook } from '@claude-code/config/types'
import { asSystemPrompt } from '@claude-code/provider/systemPromptType.js'
import { roughTokenCountEstimationForMessage } from '../tokenEstimation.js'
import { addArgumentsToPrompt, hookResponseSchema } from './hookHelpers.js'

/**
 * Ant `Cu3` (4793.js): fraction of evaluator's context window the truncator
 * will pack into a single Stop transcript. Leaves the remaining 30% for the
 * system prompt + condition wrapper + structured output.
 */
const STOP_TRANSCRIPT_BUDGET_FRACTION = 0.7

/**
 * Ant `r_8` (1996.js): default context window for stock claude models.
 * 1M-context betas get 1_000_000; everything else gets 200_000. Used as the
 * fallback when we can't read the actual window for the evaluator model.
 */
const DEFAULT_CONTEXT_WINDOW = 200_000
const ONE_MILLION_CONTEXT_WINDOW = 1_000_000

/**
 * Ant `Iu3` (4793.js): walk messages back-to-front, return the last
 * assistant message's reported input+cache+output token count (skipping
 * synthetic assistant messages). Zero if no real assistant message exists.
 */
function getLastAssistantTokenCount(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.type === 'assistant' && m.message.model !== SYNTHETIC_MODEL) {
      const usage = m.message.usage as
        | {
            input_tokens?: number
            cache_creation_input_tokens?: number
            cache_read_input_tokens?: number
            output_tokens?: number
          }
        | undefined
      if (!usage) return 0
      return (
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.output_tokens ?? 0)
      )
    }
  }
  return 0
}

/**
 * Ant `bu3` (4793.js): token estimate for a group of messages (one turn).
 * Uses real token-count helpers when the shape is recognised.
 */
function estimateGroupTokens(group: Message[]): number {
  let total = 0
  for (const msg of group) {
    total += roughTokenCountEstimationForMessage(
      msg as Parameters<typeof roughTokenCountEstimationForMessage>[0],
    )
  }
  return Math.ceil(total)
}

/**
 * Ant `hQH` (2935.js): turn-group messages so we can drop whole turns
 * cleanly. A new "turn" starts when we see an assistant message with a
 * different message.id than the previous one.
 */
function groupByTurn(messages: Message[]): Message[][] {
  const groups: Message[][] = []
  let current: Message[] = []
  let lastAssistantId: string | undefined
  for (const m of messages) {
    if (
      m.type === 'assistant' &&
      (m.message as { id?: string }).id !== lastAssistantId &&
      current.length > 0
    ) {
      groups.push(current)
      current = [m]
    } else {
      current.push(m)
    }
    if (m.type === 'assistant') {
      lastAssistantId = (m.message as { id?: string }).id
    }
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/**
 * Ant `xu3` (4793.js): truncate the Stop-hook transcript so it fits
 * inside `STOP_TRANSCRIPT_BUDGET_FRACTION × contextWindow`. Drops oldest
 * turn-groups first; emits `tengu_hook_prompt_transcript_truncated` so
 * dashboards see how often we have to prune and how much we drop.
 *
 * Returns the (possibly truncated) message list. When truncation happened,
 * prepends a system-style user message warning the evaluator that earlier
 * context may be missing — same wording as ant.
 */
function truncateStopTranscript(
  messages: Message[],
  evaluatorModel: string,
): Message[] {
  const contextWindow = has1mContext(evaluatorModel)
    ? ONE_MILLION_CONTEXT_WINDOW
    : DEFAULT_CONTEXT_WINDOW
  const budget = Math.floor(contextWindow * STOP_TRANSCRIPT_BUDGET_FRACTION)
  if (getLastAssistantTokenCount(messages) <= budget) {
    return messages
  }
  const groups = groupByTurn(messages)
  let usedTokens = 0
  let firstKeptGroup = groups.length
  for (let i = groups.length - 1; i >= 0; i--) {
    const groupTokens = estimateGroupTokens(groups[i]!)
    if (firstKeptGroup < groups.length && usedTokens + groupTokens > budget) {
      break
    }
    usedTokens += groupTokens
    firstKeptGroup = i
  }
  const kept = groups.slice(firstKeptGroup).flat()
  const droppedMessages = messages.length - kept.length
  if (droppedMessages <= 0) return messages
  logForDebugging(
    `Hooks: truncated Stop transcript ${messages.length}→${kept.length} msgs (budget ${budget}, model ${evaluatorModel})`,
  )
  logEvent('tengu_hook_prompt_transcript_truncated', {
    droppedMessages: droppedMessages as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    keptMessages: kept.length as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    budget: budget as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    evaluatorModel: evaluatorModel as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  const warning = createUserMessage({
    content: `[Earlier conversation truncated to fit the hook evaluator's context window — ${droppedMessages} earlier messages omitted. Evaluate the condition against the recent transcript below; if the required evidence may be in the omitted prefix, return {"ok": false, "reason": "insufficient evidence in transcript"}.]`,
  })
  return [warning, ...kept]
}

/**
 * Execute a prompt-based hook using an LLM.
 *
 * Stop / SubagentStop hooks behave fundamentally differently from other
 * prompt hooks (PreToolUse, PostToolUse, etc.). For Stop/SubagentStop the
 * hook's `prompt` is a *condition to verify against the transcript*
 * (e.g. /goal sets `prompt = "all tests pass"`). We must NOT send that
 * condition as a raw user-directive to the evaluator — if we did, the
 * evaluator would treat it as a task and start working on it (calling
 * tools, producing prose) instead of returning a JSON verdict, which
 * then fails the JSON parse and stalls /goal forever.
 *
 * Mirrors ant v2.1.142 4793.js (myK):
 *   - Stop/SubagentStop: wrap the user condition with a transcript-evaluator
 *     prompt, use a transcript-evaluator system prompt, and pass `tools: []`
 *     so the evaluator can't drift into doing work.
 *   - Stop/SubagentStop blocking outcome: `preventContinuation = false` so
 *     the agent keeps working toward the goal instead of halting.
 *   - JSON-parse / schema-validation failure: `non_blocking_error`, NOT
 *     blocking. Failing closed here causes infinite loops on every Stop.
 */
export async function execPromptHook(
  hook: PromptHook,
  hookName: string,
  hookEvent: HookEvent,
  jsonInput: string,
  signal: AbortSignal,
  toolUseContext: ToolUseContext,
  messages?: Message[],
  toolUseID?: string,
): Promise<HookResult> {
  // Use provided toolUseID or generate a new one
  const effectiveToolUseID = toolUseID || `hook-${randomUUID()}`
  const isStopEvent = hookEvent === 'Stop' || hookEvent === 'SubagentStop'
  try {
    // Replace $ARGUMENTS with the JSON input
    const argsApplied = addArgumentsToPrompt(hook.prompt, jsonInput)

    // For Stop/SubagentStop hooks, the user-authored prompt is a CONDITION
    // to evaluate against the transcript, not a directive to execute.
    // Wrap it so the evaluator LLM understands its job.
    const processedPrompt = isStopEvent
      ? `Based on the conversation transcript above, has the following stopping condition been satisfied? Answer based on transcript evidence only.\n\nCondition: ${argsApplied}`
      : argsApplied

    logForDebugging(
      `Hooks: Processing prompt hook with prompt: ${processedPrompt}`,
    )

    // Create user message directly - no need for processUserInput which would
    // trigger UserPromptSubmit hooks and cause infinite recursion
    const userMessage = createUserMessage({ content: processedPrompt })

    // Resolve evaluator model up front — we need it for transcript truncation
    // budget AND for the actual query call.
    const evaluatorModel = hook.model ?? getSmallFastModel()

    // For Stop/SubagentStop, filter out synthetic feedback (isMeta:true user
    // messages) before passing the transcript to the evaluator. Otherwise
    // Haiku mistakes Stop-hook-feedback / recovery-prompt / blocking-error
    // messages for genuine user replies and may declare conditions like
    // "until the user replies" satisfied after the FIRST blocking cycle —
    // killing the loop the user wanted to keep going.
    //
    // PreToolUse / PostToolUse etc keep all messages: those events are
    // tool-state evaluators, not "did the user respond" gates.
    let transcriptMessages: Message[] | undefined =
      isStopEvent && messages
        ? messages.filter(
            m =>
              !(
                m.type === 'user' &&
                (m as { isMeta?: boolean }).isMeta === true
              ),
          )
        : messages

    // ant v2.1.142 4793.js: truncate the Stop transcript when the last
    // assistant turn already used more than 70% of the evaluator's context
    // window. Drops oldest turns; emits tengu_hook_prompt_transcript_truncated.
    // Defensive: if estimation throws on an unusual message shape, fall back
    // to the un-truncated transcript so we don't silently break the hook.
    if (isStopEvent && transcriptMessages && transcriptMessages.length > 0) {
      try {
        transcriptMessages = truncateStopTranscript(
          transcriptMessages,
          evaluatorModel,
        )
      } catch (err) {
        logForDebugging(
          `Hooks: Stop transcript truncation failed (${errorMessage(err)}); using full transcript`,
        )
      }
    }

    // Prepend conversation history if provided
    const messagesToQuery =
      transcriptMessages && transcriptMessages.length > 0
        ? [...transcriptMessages, userMessage]
        : [userMessage]

    logForDebugging(
      `Hooks: Querying model with ${messagesToQuery.length} messages`,
    )

    // Query the model with Haiku
    const hookTimeoutMs = hook.timeout ? hook.timeout * 1000 : 30000

    // Combined signal: aborts if either the hook signal or timeout triggers
    const { signal: combinedSignal, cleanup: cleanupSignal } =
      createCombinedAbortSignal(signal, { timeoutMs: hookTimeoutMs })

    // Evaluator system prompt. For Stop hooks the evaluator must judge the
    // transcript and quote evidence; for other events it's a generic
    // condition checker.
    // ant v2.1.143 4798.js — Stop-condition prompt adds an "impossible"
    // verdict shape so the evaluator can give up cleanly when a goal is
    // genuinely unachievable (e.g. self-contradictory, depends on a
    // missing capability, assistant has explicitly exhausted options).
    // Non-Stop hooks keep the simpler 2-shape schema.
    const evaluatorSystemPrompt = isStopEvent
      ? `You are evaluating a stop-condition hook in Claude Code. Read the conversation transcript carefully, then judge whether the user-provided condition is satisfied.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<quote evidence from the transcript that satisfies the condition>"}
- {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}
- {"ok": false, "impossible": true, "reason": "<explain why the condition can never be satisfied>"}

Always include a "reason" field, quoting specific text from the transcript whenever possible. If the transcript does not contain clear evidence that the condition is satisfied, return {"ok": false, "reason": "insufficient evidence in transcript"}.

Only use {"ok": false, "impossible": true} when the condition is genuinely unachievable in this session — for example: the condition is self-contradictory, it depends on a resource or capability that is unavailable, or the assistant has explicitly tried, exhausted reasonable approaches, and stated it cannot be done. Apply your own judgment when deciding this — the assistant claiming the goal is impossible is evidence, not proof; independently confirm the condition is genuinely unachievable rather than deferring to the assistant's self-assessment. Do not use it just because the goal has not been reached yet or because progress is slow. When in doubt, return {"ok": false} without "impossible".

Important judgement rules:
- The user message that SET the goal does not itself satisfy the goal. For example, if the user says "say hi until I reply" and no later user message exists, the condition "the user has replied" is NOT met.
- A condition like "until the user replies / responds / says X" requires a NEW user message AFTER the goal was set. The goal-setting message itself is the request, not the reply.
- Only count statements the assistant actually produced toward goals like "say X". The condition itself is not evidence; the assistant's output is.
- If in doubt, return ok:false. False positives end the loop early; false negatives just let the agent keep working.`
      : `You are evaluating a hook condition in Claude Code. Judge whether the user-provided condition is met.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<reason the condition is met>"}
- {"ok": false, "reason": "<reason the condition is not met>"}

Always include a "reason" field.`

    try {
      const response = await queryModelWithoutStreaming({
        messages: messagesToQuery,
        systemPrompt: asSystemPrompt([evaluatorSystemPrompt]),
        thinkingConfig: { type: 'disabled' as const },
        // CRITICAL: do NOT pass the host's tools. Prompt hooks are
        // pure judges — wiring tools makes Haiku try to *do* the work
        // described by the condition instead of returning a verdict.
        tools: [],
        signal: combinedSignal,
        options: {
          async getToolPermissionContext() {
            const appState = toolUseContext.getAppState()
            return appState.toolPermissionContext
          },
          model: evaluatorModel,
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          agents: [],
          querySource: 'hook_prompt',
          mcpTools: [],
          agentId: toolUseContext.agentId,
          outputFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                reason: { type: 'string' },
                // ant v2.1.143 4798.js: optional. Only honored on Stop /
                // SubagentStop hooks; ignored elsewhere.
                impossible: { type: 'boolean' },
              },
              required: ['ok', 'reason'],
              additionalProperties: false,
            },
          },
        },
      })

      cleanupSignal()

      // If the evaluator API call itself errored, surface as a non-blocking
      // error so the Stop hook doesn't loop on infrastructure failures.
      if ((response as { isApiErrorMessage?: boolean }).isApiErrorMessage) {
        const errText = extractTextContent(
          Array.isArray(response.message.content) ? response.message.content : [],
        ).trim()
        logForDebugging(
          `Hooks: prompt-hook evaluator API error: ${errText}`,
        )
        return {
          hook,
          outcome: 'non_blocking_error',
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID: effectiveToolUseID,
            hookEvent,
            stderr: `Hook evaluator API error: ${errText}`,
            stdout: '',
            exitCode: 1,
          }),
        }
      }

      // Extract text content from response
      const content = extractTextContent(Array.isArray(response.message.content) ? response.message.content : [])

      // Update response length for spinner display
      toolUseContext.setResponseLength(length => length + content.length)

      const fullResponse = content.trim()
      logForDebugging(`Hooks: Model response: ${fullResponse}`)

      // Some models wrap JSON in markdown fences or include leading/trailing
      // text even with structured output requested. Extract JSON aggressively:
      //   1. Try raw parse (pure JSON response — best case)
      //   2. Try extracting from ```json ... ``` fences
      //   3. Try extracting from ``` ... ``` fences (no language tag)
      //   4. Try finding the first { or [ ... } or ] in the response
      let json = safeParseJSON(fullResponse)
      if (!json) {
        // Markdown code fence extraction: match ```json or ``` blocks
        const fenceMatch =
          /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(fullResponse)
        if (fenceMatch) {
          json = safeParseJSON(fenceMatch[1]!.trim())
        }
      }
      if (!json) {
        // Last resort: find first JSON object/array in the text
        const braceIdx = fullResponse.indexOf('{')
        const bracketIdx = fullResponse.indexOf('[')
        const startIdx =
          braceIdx === -1
            ? bracketIdx
            : bracketIdx === -1
              ? braceIdx
              : Math.min(braceIdx, bracketIdx)
        if (startIdx >= 0) {
          const endIdx =
            fullResponse[startIdx] === '{'
              ? fullResponse.lastIndexOf('}')
              : fullResponse.lastIndexOf(']')
          if (endIdx > startIdx) {
            json = safeParseJSON(fullResponse.slice(startIdx, endIdx + 1))
          }
        }
      }
      if (!json) {
        logForDebugging(
          `Hooks: error parsing response as JSON: ${fullResponse}`,
        )
        // Non-blocking: a stuck evaluator must not loop the Stop hook.
        // The model gets a non_blocking_error attachment but the turn ends
        // normally (ant 4793.js does the same — it's the only safe choice).
        return {
          hook,
          outcome: 'non_blocking_error',
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID: effectiveToolUseID,
            hookEvent,
            stderr: 'JSON validation failed',
            stdout: fullResponse,
            exitCode: 1,
          }),
        }
      }

      const parsed = hookResponseSchema().safeParse(json)
      if (!parsed.success) {
        logForDebugging(
          `Hooks: model response does not conform to expected schema: ${parsed.error.message}`,
        )
        return {
          hook,
          outcome: 'non_blocking_error',
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID: effectiveToolUseID,
            hookEvent,
            stderr: `Schema validation failed: ${parsed.error.message}`,
            stdout: fullResponse,
            exitCode: 1,
          }),
        }
      }

      // Failed to meet condition
      if (!parsed.data.ok) {
        // ant v2.1.143 4798.js — Stop-condition hooks can return
        // `impossible:true` to signal "give up cleanly". We treat that as
        // a success outcome (so the goal hook is removed) but flag
        // `impossible:true` on the HookResult so stopHooksCore can emit
        // `goal_status {met:false, failed:true}` instead of the normal
        // achievement attachment. Only honored for Stop/SubagentStop.
        if (parsed.data.impossible === true && isStopEvent) {
          logForDebugging(
            `Hooks: Prompt hook condition judged impossible: ${parsed.data.reason}`,
          )
          return {
            hook,
            outcome: 'success',
            impossible: true,
            stopReason: parsed.data.reason,
            message: createAttachmentMessage({
              type: 'hook_success',
              hookName,
              toolUseID: effectiveToolUseID,
              hookEvent,
              content: '',
            }),
          } as HookResult
        }
        logForDebugging(
          `Hooks: Prompt hook condition was not met: ${parsed.data.reason}`,
        )
        return {
          hook,
          outcome: 'blocking',
          blockingError: {
            // Format: `[<original-condition>]: <reason>` — matches ant 4793.js
            // so /goal status renders cleanly via formatLastCheck(reason).
            blockingError: `[${hook.prompt}]: ${parsed.data.reason ?? ''}`,
            command: hook.prompt,
          },
          // ant v2.1.142 4793.js: `preventContinuation:!Y&&H.continueOnBlock!==!0`
          // - Stop/SubagentStop: never prevent (loop semantics — /goal keeps going)
          // - Other events: prevent unless the hook opts into continueOnBlock=true
          preventContinuation:
            !isStopEvent && (hook as { continueOnBlock?: boolean }).continueOnBlock !== true,
          stopReason: parsed.data.reason,
        }
      }

      // Condition was met
      logForDebugging(`Hooks: Prompt hook condition was met`)
      return {
        hook,
        outcome: 'success',
        stopReason: parsed.data.reason,
        message: createAttachmentMessage({
          type: 'hook_success',
          hookName,
          toolUseID: effectiveToolUseID,
          hookEvent,
          content: '',
        }),
      }
    } catch (error) {
      cleanupSignal()

      if (combinedSignal.aborted) {
        return {
          hook,
          outcome: 'cancelled',
        }
      }
      throw error
    }
  } catch (error) {
    const errorMsg = errorMessage(error)
    logForDebugging(`Hooks: Prompt hook error: ${errorMsg}`)
    return {
      hook,
      outcome: 'non_blocking_error',
      message: createAttachmentMessage({
        type: 'hook_non_blocking_error',
        hookName,
        toolUseID: effectiveToolUseID,
        hookEvent,
        stderr: `Error executing prompt hook: ${errorMsg}`,
        stdout: '',
        exitCode: 1,
      }),
    }
  }
}
