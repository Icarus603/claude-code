/**
 * Port of ant v2.1.136 QN8 (4054.js) — `mcp_server_connection` structured
 * OTel event helper. Extracted from clientRuntime.ts so the wiring at
 * the two call sites is a one-liner and clientRuntime.ts stays under
 * its grandfather LOC budget.
 *
 * server_name + error detail are gated on OTEL_LOG_TOOL_DETAILS so
 * customer dashboards stay scrubbed by default.
 */

import {
  logMcpServerConnectionEvent,
  toolDetailsLoggingEnabled,
} from '@claude-code/local-observability/telemetry'
import { errorMessage } from '@claude-code/local-observability/errorHelpers.js'

export function emitMcpConnectionEvent(
  name: string,
  serverRef: { type?: string; scope?: string },
  status: 'success' | 'failure',
  durationMs: number,
  error?: unknown,
): void {
  const errCode = (error as { code?: unknown } | undefined)?.code
  void logMcpServerConnectionEvent({
    serverName: name,
    transportType: serverRef.type ?? 'stdio',
    serverScope: serverRef.scope ?? 'unknown',
    status,
    durationMs,
    errorCode: typeof errCode === 'string' ? errCode : undefined,
    errorDetail: error !== undefined ? errorMessage(error) : undefined,
    includeIdentifyingFields: toolDetailsLoggingEnabled(),
  })
}
