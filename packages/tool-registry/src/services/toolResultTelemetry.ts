/**
 * Port of ant v2.1.136 k5("tool_result") (3952.js) — success + failure
 * paths share most fields; helpers here keep toolExecution.ts under its
 * grandfather LOC budget.
 *
 * Pre-fix ccb had a P0 typo `use_id` instead of `tool_use_id` on the
 * failure path AND was missing `tool_input_size_bytes` on both paths.
 * The error body is gated on OTEL_LOG_TOOL_DETAILS to match ant `P$()`.
 */

import {
  logOTelEvent,
  toolDetailsLoggingEnabled,
} from '@claude-code/local-observability/telemetry'

import { errorMessage } from '@claude-code/local-observability/errorHelpers.js'
import { jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import { classifyToolError } from './classifyToolError.js'

type ToolResultBase = {
  toolName: string
  toolUseID: string
  durationMs: number
  processedInput: unknown
  toolParameters: Record<string, unknown>
  telemetryToolInput?: string
  decisionInfo?: { source: string; decision: string }
  mcpServerScope?: string | null
}

export function emitToolResultSuccess(
  args: ToolResultBase & { toolResultSizeBytes: number },
): void {
  void logOTelEvent('tool_result', {
    tool_name: args.toolName,
    tool_use_id: args.toolUseID,
    success: 'true',
    duration_ms: String(args.durationMs),
    ...(Object.keys(args.toolParameters).length > 0 && {
      tool_parameters: jsonStringify(args.toolParameters),
    }),
    ...(args.telemetryToolInput && { tool_input: args.telemetryToolInput }),
    tool_input_size_bytes: String(jsonStringify(args.processedInput).length),
    tool_result_size_bytes: String(args.toolResultSizeBytes),
    ...(args.decisionInfo && {
      decision_source: args.decisionInfo.source,
      decision_type: args.decisionInfo.decision,
    }),
    ...(args.mcpServerScope && { mcp_server_scope: args.mcpServerScope }),
  })
}

export function emitToolResultFailure(args: ToolResultBase & { error: unknown }): void {
  void logOTelEvent('tool_result', {
    tool_name: args.toolName,
    tool_use_id: args.toolUseID,
    success: 'false',
    duration_ms: String(args.durationMs),
    error_type: classifyToolError(args.error),
    ...(toolDetailsLoggingEnabled() && { error: errorMessage(args.error) }),
    ...(Object.keys(args.toolParameters).length > 0 && {
      tool_parameters: jsonStringify(args.toolParameters),
    }),
    ...(args.telemetryToolInput && { tool_input: args.telemetryToolInput }),
    tool_input_size_bytes: String(jsonStringify(args.processedInput).length),
    ...(args.decisionInfo && {
      decision_source: args.decisionInfo.source,
      decision_type: args.decisionInfo.decision,
    }),
    ...(args.mcpServerScope && { mcp_server_scope: args.mcpServerScope }),
  })
}
