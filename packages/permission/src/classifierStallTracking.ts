import type Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { sideQuery, type SideQueryOptions } from '@claude-code/agent/sideQuery.js'
import { createCombinedAbortSignal } from '@claude-code/agent/combinedAbortSignal.js'
import { isAbortError } from '@claude-code/local-observability/errorHelpers.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { resolveAntModel } from '@claude-code/provider/antModels.js'

/**
 * Thinking config for classifier calls. The classifier wants short text-only
 * responses — API thinking blocks are ignored by extractTextContent() and waste tokens.
 *
 * For most models: send { type: 'disabled' } via sideQuery's `thinking: false`.
 *
 * Models with alwaysOnThinking (declared in tengu_ant_model_override) default
 * to adaptive thinking server-side and reject `disabled` with a 400. For those:
 * don't pass `thinking: false`, instead pad max_tokens so adaptive thinking
 * (observed 0–1114 tokens replaying go/ccshare/shawnm-20260310-202833) doesn't
 * exhaust the budget before <block> is emitted. Without headroom,
 * stop_reason=max_tokens yields an empty text response → parseXmlBlock('')
 * → null → "unparseable" → safe commands blocked.
 *
 * Returns [disableThinking, headroom] — tuple instead of named object so
 * property-name strings don't survive minification into external builds.
 */
export function getClassifierThinkingConfig(
  model: string,
): [false | undefined, number] {
  if (
    process.env.USER_TYPE === 'ant' &&
    resolveAntModel(model)?.alwaysOnThinking
  ) {
    return [undefined, 2048]
  }
  return [false, 0]
}

// ============================================================================
// Stall tracking + per-stage timeouts (ant Rp5 / WR8)
//
// Generic instrumentation layer that wraps an auto-mode classifier sideQuery
// with (1) heartbeat logging so a hung request is visible in --debug, and
// (2) an outer wall-clock timeout layered over sideQuery's own per-fetch
// timeout. Lives in its own module because it is API-call plumbing, not
// classification logic — yoloClassifier.ts consumes it but doesn't own it.
// ============================================================================

/**
 * Wall-clock timeout for stage 1 (fast) — ant LZ7. Short because stage 1 is a
 * 64–256 token immediate decision.
 */
export const CLASSIFIER_STAGE1_TIMEOUT_MS = 30000
/**
 * Wall-clock timeout for stage 2 (thinking) and the single-shot tool_use
 * classifier — ant fR8. Larger to allow chain-of-thought.
 */
export const CLASSIFIER_STAGE2_TIMEOUT_MS = 120000
/**
 * Inner per-fetch timeout handed to sideQuery — ant kZ7. Sits inside the
 * outer wall-clock signal so an individual fetch attempt can't hang the whole
 * budget. ant forces this on every classifier call regardless of stage.
 */
const CLASSIFIER_FETCH_TIMEOUT_MS = 60000

/** Mutable per-stage fetch-attempt counter (ant's `{count:0}` object). */
export type AttemptCounter = { count: number }

/**
 * Metadata for a classifier API call's stall log lines (ant Rp5's `_` arg).
 */
export type ClassifierStallMeta = {
  toolName: string
  classifierModel: string
  classifierStage: 'xml_s1' | 'xml_s2' | 'tool_use'
  promptTokensEstimate?: number
}

/**
 * Wrap a classifier API promise with stall heartbeat logging. Mirrors ant
 * Rp5 exactly: a started line, a progress line at 15s then every 30s up to 10
 * times, and a finished line carrying outcome + duration. The heartbeats let
 * operators see a hung classifier in --debug logs instead of a silent stall.
 * The promise is returned/thrown through unchanged.
 */
async function runClassifierWithStallTracking<T>(
  promise: Promise<T>,
  meta: ClassifierStallMeta,
): Promise<T> {
  const start = Date.now()
  const reqId = randomUUID()
  const estSuffix =
    meta.promptTokensEstimate !== undefined
      ? ` promptTokensEst=${meta.promptTokensEstimate}`
      : ''
  logForDebugging(
    `[Stall] classifier_request_started reqId=${reqId} tool=${meta.toolName} model=${meta.classifierModel} stage=${meta.classifierStage}${estSuffix}`,
    { level: 'info' },
  )
  let progressCount = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const scheduleHeartbeat = (delayMs: number) => {
    timer = setTimeout(() => {
      timer = null
      const ageMs = Date.now() - start
      logForDebugging(
        `[Stall] classifier_request_progress reqId=${reqId} tool=${meta.toolName} stage=${meta.classifierStage} ageMs=${ageMs}`,
        { level: 'warn' },
      )
      if (++progressCount < 10) scheduleHeartbeat(30000)
    }, delayMs)
    timer.unref?.()
  }
  scheduleHeartbeat(15000)
  try {
    const result = await promise
    const durationMs = Date.now() - start
    logForDebugging(
      `[Stall] classifier_request_finished reqId=${reqId} tool=${meta.toolName} stage=${meta.classifierStage} outcome=ok durationMs=${durationMs}`,
      { level: 'info' },
    )
    return result
  } catch (error) {
    const durationMs = Date.now() - start
    const aborted = isAbortError(error)
    const outcome = aborted ? 'aborted' : 'error'
    const errorKind =
      error instanceof Error
        ? `${error.name}:${error.message.slice(0, 80)}`
        : 'unknown'
    logForDebugging(
      `[Stall] classifier_request_finished reqId=${reqId} tool=${meta.toolName} stage=${meta.classifierStage} outcome=${outcome} durationMs=${durationMs} errorKind=${errorKind}`,
      { level: aborted ? 'info' : 'warn' },
    )
    throw error
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/**
 * Run a classifier sideQuery under an outer wall-clock timeout + stall
 * tracking. Mirrors ant WR8: builds a timeout-linked abort signal (fk →
 * createCombinedAbortSignal), forces the inner per-fetch timeout (kZ7), wires
 * the attempt counter via onFetchAttempt, and routes the call through
 * runClassifierWithStallTracking. Cleans up the timeout signal in finally.
 */
export async function sideQueryWithStallTracking(
  outerSignal: AbortSignal,
  opts: SideQueryOptions,
  meta: ClassifierStallMeta,
  timeoutMs: number,
  counter?: AttemptCounter,
): Promise<Anthropic.Beta.Messages.BetaMessage> {
  const { signal, cleanup } = createCombinedAbortSignal(outerSignal, {
    timeoutMs,
  })
  try {
    return await runClassifierWithStallTracking(
      sideQuery({
        ...opts,
        timeout: CLASSIFIER_FETCH_TIMEOUT_MS,
        signal,
        ...(counter && { onFetchAttempt: () => counter.count++ }),
      }),
      meta,
    )
  } finally {
    cleanup()
  }
}
