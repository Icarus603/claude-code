/**
 * Port of ant ZzH (2642.js) — `compaction` OTel event helper. Extracted
 * from compact.ts so the call sites stay one-liners.
 */

import { logCompactionEvent } from '@claude-code/local-observability/telemetry'

export function emitCompactionSuccess(
  trigger: string,
  startMs: number,
  preTokens: number,
  postTokens: number,
): void {
  void logCompactionEvent({
    trigger,
    success: true,
    durationMs: Date.now() - startMs,
    preTokens,
    postTokens,
  })
}

export function emitCompactionFailure(
  trigger: string,
  startMs: number,
  error: unknown,
): void {
  void logCompactionEvent({
    trigger,
    success: false,
    durationMs: Date.now() - startMs,
    error: error instanceof Error ? error.message : String(error),
  })
}
