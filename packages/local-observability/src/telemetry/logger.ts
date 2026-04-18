/**
 * V7 §8.12 — telemetry/logger: OpenTelemetry `DiagLogger` adapter.
 *
 * Moved from src/utils/telemetry/logger.ts. Bridges OTel's internal
 * diagnostic emissions into local-observability's error-log surface.
 */

import type { DiagLogger } from '@opentelemetry/api'

import { logForDebugging } from '../_deps.js'
import { logError } from '../logging/error-log.js'

export class ClaudeCodeDiagLogger implements DiagLogger {
  error(message: string, ..._: unknown[]) {
    logError(new Error(message))
    logForDebugging(`[3P telemetry] OTEL diag error: ${message}`, {
      level: 'error',
    })
  }
  warn(message: string, ..._: unknown[]) {
    logError(new Error(message))
    logForDebugging(`[3P telemetry] OTEL diag warn: ${message}`, {
      level: 'warn',
    })
  }
  info(_message: string, ..._args: unknown[]) {}
  debug(_message: string, ..._args: unknown[]) {}
  verbose(_message: string, ..._args: unknown[]) {}
}
