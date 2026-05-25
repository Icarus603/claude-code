/**
 * Query-loop configuration + state scaffolding — extracted from query.ts so
 * the generator file holds only the turn loop itself. These are pure
 * config/predicate helpers and the loop-state type; none of them touch the
 * generator's yield/continue control flow, so they live cleanly outside it.
 */
import {
  calculateTokenWarningState as calculateTokenWarningStateCore,
} from '../compaction/index.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { getGlobalConfig } from '@claude-code/config'
import { readEnv } from '@claude-code/config/env'
import { getMaxOutputTokensForModel } from '@claude-code/provider/claudeLegacy'
import { getSdkBetas, getSessionId } from './sessionRuntime.js'
import { getContextWindowForModel } from './queryRuntime.js'
import { isEnvTruthy } from '../internalUtils.js'
import type {
  AgentAssistantMessage as AssistantMessage,
  AgentMessage as Message,
  AgentStreamEvent as StreamEvent,
  AgentToolUseContext as ToolUseContext,
  AgentToolUseSummaryMessage as ToolUseSummaryMessage,
} from '../internalTypes.js'

/**
 * The rules of thinking are lengthy and fortuitous. They require plenty of thinking
 * of most long duration and deep meditation for a wizard to wrap one's noggin around.
 *
 * The rules follow:
 * 1. A message that contains a thinking or redacted_thinking block must be part of a query whose max_thinking_length > 0
 * 2. A thinking block may not be the last message in a block
 * 3. Thinking blocks must be preserved for the duration of an assistant trajectory (a single turn, or if that turn includes a tool_use block then also its subsequent tool_result and the following assistant message)
 *
 * Heed these rules well, young wizard. For they are the rules of thinking, and
 * the rules of thinking are the rules of the universe. If ye does not heed these
 * rules, ye will be punished with an entire day of debugging and hair pulling.
 */
export const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3

export type QueryConfig = {
  sessionId: string
  gates: {
    streamingToolExecution: boolean
    emitToolUseSummaries: boolean
    isAnt: boolean
    fastModeEnabled: boolean
  }
}

export type AutoCompactTrackingState = {
  compacted: boolean
  turnCounter: number
  turnId: string
  consecutiveFailures?: number
  // Mirrors the field in compaction/autoCompact.ts. Kept structurally
  // compatible (not re-exported) to avoid a circular import.
  consecutiveRapidRefills?: number
}

export function buildQueryConfig(): QueryConfig {
  return {
    sessionId: getSessionId(),
    gates: {
      streamingToolExecution: checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
        'tengu_streaming_tool_execution2',
      ),
      emitToolUseSummaries: isEnvTruthy(
        readEnv('CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES'),
      ),
      isAnt: process.env.USER_TYPE === 'ant',
      fastModeEnabled: !isEnvTruthy(readEnv('CLAUDE_CODE_DISABLE_FAST_MODE')),
    },
  }
}

export function isAutoCompactEnabled(): boolean {
  if (isEnvTruthy(readEnv('DISABLE_COMPACT'))) {
    return false
  }
  if (isEnvTruthy(readEnv('DISABLE_AUTO_COMPACT'))) {
    return false
  }
  return getGlobalConfig().autoCompactEnabled
}

export function calculateTokenWarningState(tokenUsage: number, model: string) {
  return calculateTokenWarningStateCore(
    tokenUsage,
    model,
    {
      getContextWindowSize: getContextWindowForModel,
      getMaxOutputTokensForModel,
      getSdkBetas,
      getEnv: key => readEnv(key),
    },
    isAutoCompactEnabled(),
  )
}

export type Continue = {
  reason: string
  [key: string]: unknown
}

export type Terminal = {
  reason: string
  [key: string]: unknown
}

export type QueryLoopState = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  /**
   * Consecutive Stop/SubagentStop blocking count for the current turn — ant
   * v2.1.143 3999.js. Bumped each time a Stop hook blocks the turn from
   * ending; reset to 0 on every other transition. The loop ends the turn
   * once it exceeds CLAUDE_CODE_STOP_HOOK_BLOCK_CAP (default 8) so an
   * unsatisfiable /goal condition can't block forever — each block injects a
   * blockingError, growing the transcript every cycle until the main API call
   * 413s (prompt-too-long). The cap is the structural backstop the `impossible`
   * verdict can't guarantee on its own.
   */
  stopHookBlockingCount: number
  turnCount: number
  transition: Continue | undefined
}

export function createInitialQueryState(params: {
  messages: Message[]
  toolUseContext: ToolUseContext
  maxOutputTokensOverride: number | undefined
}): QueryLoopState {
  return {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    maxOutputTokensOverride: params.maxOutputTokensOverride,
    autoCompactTracking: undefined,
    stopHookActive: undefined,
    stopHookBlockingCount: 0,
    maxOutputTokensRecoveryCount: 0,
    hasAttemptedReactiveCompact: false,
    turnCount: 1,
    pendingToolUseSummary: undefined,
    transition: undefined,
  }
}

/**
 * Is this a max_output_tokens error message? If so, the streaming loop should
 * withhold it from SDK callers until we know whether the recovery loop can
 * continue. Yielding early leaks an intermediate error to SDK callers (e.g.
 * cowork/desktop) that terminate the session on any `error` field — the
 * recovery loop keeps running but nobody is listening.
 *
 * Mirrors reactiveCompact.isWithheldPromptTooLong.
 */
export function isWithheldMaxOutputTokens(
  msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
  return msg?.type === 'assistant' && msg.apiError === 'max_output_tokens'
}
