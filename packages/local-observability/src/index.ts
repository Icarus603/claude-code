export type {
  EventMetadata,
  HealthProbe,
  LocalObservability,
  Logger,
  MetricsRecorder,
  Span,
  Tracer,
} from './contracts.js'

export {
  installLocalObservability,
  getLocalObservability,
  logEvent,
  logEventAsync,
  startSpan,
  endSpan,
  shutdownLocalObservability,
} from './core.js'

export * from './spans.js'
export * from './errors.js'
export type {
  AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
} from './compat.js'
