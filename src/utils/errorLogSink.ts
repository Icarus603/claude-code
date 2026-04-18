/**
 * V7 §10.3 facade — error log sink implementation moved to
 * `@claude-code/local-observability/logging/error-log-sink`.
 *
 * Do not add new logic here. This file exists only to keep legacy call
 * sites (preAction hook, startup routines) importing
 * `initializeErrorLogSink` from the same relative path as before.
 */

export {
  _clearLogWritersForTesting,
  _flushLogWritersForTesting,
  getErrorsPath,
  getMCPLogsPath,
  initializeErrorLogSink,
} from '@claude-code/local-observability/logging'
