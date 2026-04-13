/**
 * @claude-code/local-observability/testing
 *
 * V7 §9.11 — in-memory fakes for local-observability.
 *
 * NullObservability : silent no-op — use when the test does not care about
 *                     observability side-effects at all.
 * RecordingObservability : captures every call — use when a test needs to
 *                          assert that a log / span / metric / health report
 *                          was (or was not) emitted.
 *
 * These exports must NOT import from ../internal/ (V7 §9.11 hard rule).
 */

import type {
  EventMetadata,
  HealthProbe,
  LocalObservability,
  Logger,
  MetricsRecorder,
  Span,
  Tracer,
} from '../contracts.js'

// Re-export contracts so tests only need one import.
export type {
  EventMetadata,
  HealthProbe,
  LocalObservability,
  Logger,
  MetricsRecorder,
  Span,
  Tracer,
}

// ---------------------------------------------------------------------------
// NullObservability
// ---------------------------------------------------------------------------

const _nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  event: () => {},
}

const _nullTracer: Tracer = {
  startSpan(name, attributes): Span {
    return { name, startedAt: Date.now(), attributes }
  },
  endSpan(span, attributes): void {
    span.endedAt = Date.now()
    if (attributes) span.attributes = { ...(span.attributes ?? {}), ...attributes }
  },
}

const _nullMetrics: MetricsRecorder = {
  increment: () => {},
  timing: () => {},
}

const _nullHealth: HealthProbe = {
  report: () => {},
}

/**
 * NullObservability — a `LocalObservability` implementation whose every
 * method is a silent no-op. Suitable for tests that don't need to verify
 * observability behaviour.
 */
export const NullObservability: LocalObservability = {
  logger: _nullLogger,
  tracer: _nullTracer,
  metrics: _nullMetrics,
  health: _nullHealth,
}

// ---------------------------------------------------------------------------
// RecordingObservability
// ---------------------------------------------------------------------------

export type LogRecord = {
  level: 'debug' | 'info' | 'warn' | 'error' | 'event'
  message: string
  metadata?: EventMetadata
}

export type MetricRecord =
  | { kind: 'increment'; name: string; value: number }
  | { kind: 'timing'; name: string; durationMs: number }

export type HealthRecord = {
  name: string
  status: 'ok' | 'warn' | 'error'
  details?: unknown
}

/**
 * RecordingObservability — captures every observability call into typed
 * arrays. Tests can inspect `.logs`, `.spans`, `.metrics`, and `.health`
 * after exercising the system under test.
 *
 * ```ts
 * const obs = new RecordingObservability()
 * installLocalObservability(obs.observability)
 * // ... run code ...
 * expect(obs.logs).toContainEqual({ level: 'warn', message: 'low memory' })
 * ```
 */
export class RecordingObservability {
  readonly logs: LogRecord[] = []
  readonly spans: Span[] = []
  readonly metrics: MetricRecord[] = []
  readonly health: HealthRecord[] = []

  private readonly _logger: Logger = {
    debug: (msg, meta) => this.logs.push({ level: 'debug', message: msg, metadata: meta }),
    info: (msg, meta) => this.logs.push({ level: 'info', message: msg, metadata: meta }),
    warn: (msg, meta) => this.logs.push({ level: 'warn', message: msg, metadata: meta }),
    error: (msg, meta) => this.logs.push({ level: 'error', message: msg, metadata: meta }),
    event: (name, meta) => this.logs.push({ level: 'event', message: name, metadata: meta }),
  }

  private readonly _tracer: Tracer = {
    startSpan: (name, attributes): Span => {
      const span: Span = { name, startedAt: Date.now(), attributes }
      this.spans.push(span)
      return span
    },
    endSpan: (span, attributes): void => {
      span.endedAt = Date.now()
      if (attributes) span.attributes = { ...(span.attributes ?? {}), ...attributes }
    },
  }

  private readonly _metrics: MetricsRecorder = {
    increment: (name, value = 1) => this.metrics.push({ kind: 'increment', name, value }),
    timing: (name, durationMs) => this.metrics.push({ kind: 'timing', name, durationMs }),
  }

  private readonly _health: HealthProbe = {
    report: (name, status, details) => this.health.push({ name, status, details }),
  }

  /** The `LocalObservability` object to pass to `installLocalObservability()`. */
  readonly observability: LocalObservability = {
    logger: this._logger,
    tracer: this._tracer,
    metrics: this._metrics,
    health: this._health,
  }

  /** Clear all recorded data. Useful between test cases. */
  reset(): void {
    this.logs.length = 0
    this.spans.length = 0
    this.metrics.length = 0
    this.health.length = 0
  }
}
