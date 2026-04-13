/**
 * V7 §6.5 — LocalObservabilityError typed error namespace.
 */
export class LocalObservabilityBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LocalObservabilityBaseError'
    this.code = code
  }
}

export class LoggerError extends LocalObservabilityBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('LOCAL_OBSERVABILITY_LOGGER_ERROR', message, options)
    this.name = 'LocalObservabilityLoggerError'
  }
}

export class TracerError extends LocalObservabilityBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('LOCAL_OBSERVABILITY_TRACER_ERROR', message, options)
    this.name = 'LocalObservabilityTracerError'
  }
}

export class MetricsError extends LocalObservabilityBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('LOCAL_OBSERVABILITY_METRICS_ERROR', message, options)
    this.name = 'LocalObservabilityMetricsError'
  }
}
