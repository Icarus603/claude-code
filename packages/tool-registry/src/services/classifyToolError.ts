/**
 * Tool error classification for telemetry.
 *
 * Extracted from toolExecution.ts so toolResultTelemetry.ts can import
 * it without creating a cycle (toolResultTelemetry depends on
 * classifyToolError; toolExecution depends on toolResultTelemetry's
 * emit helpers).
 *
 * In minified/external builds, `error.constructor.name` is mangled into
 * short identifiers like "nJT" or "Chq" — useless for diagnostics.
 * This function extracts structured, telemetry-safe info instead:
 *   - TelemetrySafeError: use its telemetryMessage (already vetted)
 *   - Node.js fs errors: log the error code (ENOENT, EACCES, etc.)
 *   - Known error types: use their unminified name
 *   - Fallback: "Error" (better than a mangled 3-char identifier)
 */

import {
  getErrnoCode,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '@claude-code/local-observability/errorHelpers.js'

export function classifyToolError(error: unknown): string {
  if (
    error instanceof TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  ) {
    return error.telemetryMessage.slice(0, 200)
  }
  if (error instanceof Error) {
    const errnoCode = getErrnoCode(error)
    if (typeof errnoCode === 'string') {
      return `Error:${errnoCode}`
    }
    if (error.name && error.name !== 'Error' && error.name.length > 3) {
      return error.name.slice(0, 60)
    }
    return 'Error'
  }
  return 'UnknownError'
}
