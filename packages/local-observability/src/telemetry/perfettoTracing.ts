/**
 * V7 §10.3 facade — perfetto tracing moved to
 * `@claude-code/local-observability/telemetry/perfetto`.
 */

export type {
  TraceEvent,
  TraceEventPhase,
} from '@claude-code/local-observability/telemetry'
export {
  MAX_EVENTS_FOR_TESTING,
  emitPerfettoCounter,
  emitPerfettoInstant,
  endInteractionPerfettoSpan,
  endLLMRequestPerfettoSpan,
  endToolPerfettoSpan,
  endUserInputPerfettoSpan,
  evictOldestEventsForTesting,
  evictStaleSpansForTesting,
  getPerfettoEvents,
  initializePerfettoTracing,
  isPerfettoTracingEnabled,
  registerAgent,
  resetPerfettoTracer,
  startInteractionPerfettoSpan,
  startLLMRequestPerfettoSpan,
  startToolPerfettoSpan,
  startUserInputPerfettoSpan,
  triggerPeriodicWriteForTesting,
  unregisterAgent,
} from '@claude-code/local-observability/telemetry'
