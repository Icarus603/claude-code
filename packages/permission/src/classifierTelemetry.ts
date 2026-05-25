import { APIConnectionError, APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk'
import { logEvent } from '@claude-code/local-observability'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '@claude-code/agent/eventMetadata.js'
import { getErrnoCode, isAbortError } from '@claude-code/local-observability/errorHelpers.js'
import { parsePromptTooLongTokenCounts } from '@claude-code/provider/errors.js'

// ============================================================================
// Auto-mode classifier telemetry (ant Wd / oZ7 / aZ7)
//
// Outcome logging + error classification for the auto-mode classifier. Pure
// telemetry/error-shape helpers — no classification logic — split out of
// yoloClassifier.ts to keep the decision engine focused.
// ============================================================================

export type AutoModeOutcome =
  | 'success'
  | 'parse_failure'
  | 'interrupted'
  | 'error'
  | 'transcript_too_long'

/**
 * Telemetry helper for tengu_auto_mode_outcome. All string fields are
 * enum-like values (outcome, model name, classifier type, failure kind) —
 * never code or file paths, so the AnalyticsMetadata casts are safe.
 */
export function logAutoModeOutcome(
  outcome: AutoModeOutcome,
  model: string,
  extra?: {
    classifierType?: string
    failureKind?: string
    errorKind?: string
    durationMs?: number
    mainLoopTokens?: number
    classifierInputTokens?: number
    classifierTokensEst?: number
    transcriptActualTokens?: number
    transcriptLimitTokens?: number
    stage1Attempts?: number
    stage2Attempts?: number
  },
): void {
  const { classifierType, failureKind, errorKind, ...rest } = extra ?? {}
  logEvent('tengu_auto_mode_outcome', {
    outcome:
      outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    classifierModel:
      model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(classifierType !== undefined && {
      classifierType:
        classifierType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(failureKind !== undefined && {
      failureKind:
        failureKind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(errorKind !== undefined && {
      errorKind:
        errorKind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...rest,
  })
}

/**
 * Classify a caught classifier API error into a stable enum string for
 * telemetry. Mirrors ant 150's oZ7() exactly, including the instanceof order:
 * APIConnectionTimeoutError must be checked before APIConnectionError because
 * the former extends the latter. wall_clock_timeout covers abort/timeout
 * (ant vE); http_NNN carries the HTTP status; errno codes (ENOTFOUND, etc.)
 * are lowercased; everything else is "other".
 */
export function classifyClassifierErrorKind(error: unknown): string {
  if (isAbortError(error)) return 'wall_clock_timeout'
  if (error instanceof APIConnectionTimeoutError) return 'connection_timeout'
  if (error instanceof APIConnectionError) return 'connection_error'
  if (error instanceof APIError && typeof error.status === 'number') {
    return `http_${error.status}`
  }
  const code = getErrnoCode(error)
  if (code) return code.toLowerCase()
  return 'other'
}

/**
 * Detect API 400 "prompt is too long: N tokens > M maximum" errors and
 * parse the token counts. Returns undefined for any other error.
 * These are deterministic (same transcript → same error) so retrying
 * won't help — unlike 429/5xx which sideQuery already retries internally.
 */
export function detectPromptTooLong(
  error: unknown,
): ReturnType<typeof parsePromptTooLongTokenCounts> | undefined {
  if (!(error instanceof Error)) return undefined
  if (!error.message.toLowerCase().includes('prompt is too long')) {
    return undefined
  }
  return parsePromptTooLongTokenCounts(error.message)
}
