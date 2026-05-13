/**
 * Port of ant v2.1.136 api_retries_exhausted helper (2914.js).
 * Extracted from claudeLegacyRuntime.ts so the call sites stay one-liners
 * and the file stays under its grandfather LOC budget.
 */

import { APIError } from '@anthropic-ai/sdk'

import { logApiRetriesExhaustedEvent } from '@claude-code/local-observability/telemetry'

export function emitApiRetriesExhausted(args: {
  error: unknown
  model: unknown // decompiled callers pass `unknown` (Options/RetryContext stub)
  attempts: number
  totalRetryDurationMs: number
  fastMode: boolean
  querySource?: unknown
  thinkingType: unknown
}): void {
  const status = args.error instanceof APIError ? String(args.error.status) : undefined
  void logApiRetriesExhaustedEvent({
    model: String(args.model),
    error: args.error instanceof Error ? args.error.message : String(args.error),
    statusCode: status,
    totalAttempts: args.attempts,
    totalRetryDurationMs: args.totalRetryDurationMs,
    speed: args.fastMode ? 'fast' : 'normal',
    querySource: typeof args.querySource === 'string' ? args.querySource : undefined,
    effort:
      typeof args.thinkingType === 'string' && args.thinkingType !== 'disabled'
        ? args.thinkingType
        : undefined,
  })
}
