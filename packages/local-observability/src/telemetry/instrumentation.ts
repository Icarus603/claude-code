/**
 * V7 §8.12 — telemetry/instrumentation: stub lifecycle hooks for OTel init
 * and flush.
 *
 * Moved from src/utils/telemetry/instrumentation.ts. The external build
 * has telemetry disabled; real initialization code lives in ant-only
 * branches that are eliminated from the public build.
 */

export async function initializeTelemetry(): Promise<null> {
  return null
}

export async function flushTelemetry(): Promise<void> {}
