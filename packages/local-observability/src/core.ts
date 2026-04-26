// Leaf module: holds the observability singleton, install/get accessors,
// logEvent/logEventAsync, startSpan/endSpan, shutdownLocalObservability.
// Extracted from index.ts to break the index ↔ {spans, compat} cycles —
// both consumers can now depend on this leaf without round-tripping
// through the barrel.

import type {
  EventMetadata,
  HealthProbe,
  LocalObservability,
  Logger,
  MetricsRecorder,
  Span,
  Tracer,
} from './contracts.js'

const noOpLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  event: () => {},
}

const noOpTracer: Tracer = {
  startSpan(name, attributes): Span {
    return {
      name,
      startedAt: Date.now(),
      attributes,
    }
  },
  endSpan(span, attributes): void {
    span.endedAt = Date.now()
    if (attributes) {
      span.attributes = {
        ...(span.attributes ?? {}),
        ...attributes,
      }
    }
  },
}

const noOpMetrics: MetricsRecorder = {
  increment: () => {},
  timing: () => {},
}

const noOpHealth: HealthProbe = {
  report: () => {},
}

let observability: LocalObservability = {
  logger: noOpLogger,
  tracer: noOpTracer,
  metrics: noOpMetrics,
  health: noOpHealth,
}

export function installLocalObservability(
  runtime: Partial<LocalObservability>,
): void {
  observability = {
    logger: runtime.logger ?? observability.logger,
    tracer: runtime.tracer ?? observability.tracer,
    metrics: runtime.metrics ?? observability.metrics,
    health: runtime.health ?? observability.health,
  }
}

export function getLocalObservability(): LocalObservability {
  return observability
}

export function logEvent(name: string, metadata: EventMetadata = {}): void {
  observability.logger.event(name, metadata)
}

export async function logEventAsync(
  name: string,
  metadata: EventMetadata = {},
): Promise<void> {
  observability.logger.event(name, metadata)
}

export function startSpan(
  name: string,
  attributes?: Record<string, unknown>,
): Span {
  return observability.tracer.startSpan(name, attributes)
}

export function endSpan(
  span: Span | undefined,
  attributes?: Record<string, unknown>,
): void {
  if (!span) {
    return
  }
  observability.tracer.endSpan(span, attributes)
}

export async function shutdownLocalObservability(): Promise<void> {}
