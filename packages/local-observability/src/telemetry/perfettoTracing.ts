/**
 * V7 §10.3 facade — perfetto tracing moved to
 * `@claude-code/local-observability/telemetry/perfetto`.
 */

export type {
  TraceEvent,
  TraceEventPhase,
} from './index.js'
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
} from './index.js'
