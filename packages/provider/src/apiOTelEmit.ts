/**
 * OTel emit helpers for api_request / api_error — extracted from logging.ts
 * to keep that file under its grandfather LOC budget.
 *
 * ant 2920.js:175 (api_error) and 2920.js:393 (api_request).
 */

import { logOTelEvent } from '@claude-code/local-observability/telemetryEvents.js'
import { redactQuerySourceForTelemetry } from './querySourceTelemetry.js'

export function emitApiErrorOTel(args: {
  model: string
  error: string
  statusCode: number | undefined
  durationMs: number
  attempt: number
  requestId: string | null | undefined
  fastMode: boolean
  querySource: string | undefined
  effort: string | undefined
}): void {
  void logOTelEvent('api_error', {
    model: args.model,
    error: args.error,
    status_code: args.statusCode !== undefined ? String(args.statusCode) : undefined,
    duration_ms: String(args.durationMs),
    attempt: String(args.attempt),
    request_id: args.requestId === null ? undefined : args.requestId,
    speed: args.fastMode ? 'fast' : 'normal',
    query_source: redactQuerySourceForTelemetry(args.querySource),
    ...(args.effort && { effort: args.effort }),
  })
}

export function emitApiRequestOTel(args: {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUSD: number
  durationMs: number
  requestId: string | null | undefined
  fastMode: boolean
  querySource: string | undefined
  effort: string | undefined
}): void {
  void logOTelEvent('api_request', {
    model: args.model,
    input_tokens: String(args.inputTokens),
    output_tokens: String(args.outputTokens),
    cache_read_tokens: String(args.cacheReadTokens),
    cache_creation_tokens: String(args.cacheCreationTokens),
    cost_usd: String(args.costUSD),
    cost_usd_micros: String(Math.round(args.costUSD * 1_000_000)),
    duration_ms: String(args.durationMs),
    request_id: args.requestId === null ? undefined : args.requestId,
    speed: args.fastMode ? 'fast' : 'normal',
    query_source: redactQuerySourceForTelemetry(args.querySource),
    ...(args.effort && { effort: args.effort }),
  })
}
