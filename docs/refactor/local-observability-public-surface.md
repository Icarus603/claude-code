# @claude-code/local-observability — exports audit

**Total**: 39  |  Public: 30  |  Internal-only: 0  |  Dead: 6  |  Protected: 4

## Truly dead (safe to remove)

- `./logging/error-log-sink.js` -> `./src/logging/error-log-sink.ts`
- `./telemetry/sessionTracing.js` -> `./src/telemetry/sessionTracing.ts`
- `./telemetry/bigqueryExporter.js` -> `./src/telemetry/bigqueryExporter.ts`
- `./telemetry/pluginTelemetry.js` -> `./src/telemetry/pluginTelemetry.ts`
- `./telemetry/betaSessionTracing.js` -> `./src/telemetry/betaSessionTracing.ts`
- `./aggregates/statsCache.js` -> `./src/aggregates/statsCache.ts`

## Internal-only (safe to remove after relativization)


## Protected entries (kept regardless of usage — V7 §9.11 / API contract)

- `.` (ext=255, int=0) -> `./src/index.ts`
- `./contracts` (ext=0, int=0) -> `./src/contracts.ts`
- `./errors` (ext=0, int=0) -> `./src/errors.ts`
- `./testing` (ext=0, int=0) -> `./src/testing/index.ts`

## Public surface

- `./debug.js` (ext=288, int=0) -> `./src/debug.ts`
- `.` (ext=255, int=0) -> `./src/index.ts`
- `./errorHelpers.js` (ext=215, int=0) -> `./src/errorHelpers.ts`
- `./logging` (ext=169, int=0) -> `./src/logging/index.ts`
- `./slowOperations.js` (ext=167, int=0) -> `./src/slowOperations.ts`
- `./log.js` (ext=66, int=0) -> `./src/log.ts`
- `./compat` (ext=34, int=0) -> `./src/compat.ts`
- `./spans` (ext=6, int=0) -> `./src/spans.ts`
- `./telemetryEvents.js` (ext=6, int=0) -> `./src/telemetryEvents.ts`
- `./aggregates/queryProfiler.js` (ext=6, int=0) -> `./src/aggregates/queryProfiler.ts`
- `./telemetry` (ext=5, int=0) -> `./src/telemetry/index.ts`
- `./sentry.js` (ext=4, int=0) -> `./src/sentry.ts`
- `./sinks.js` (ext=4, int=0) -> `./src/sinks.ts`
- `./aggregates/headlessProfiler.js` (ext=4, int=0) -> `./src/aggregates/headlessProfiler.ts`
- `./fileOperationAnalytics` (ext=3, int=0) -> `./src/fileOperationAnalytics.ts`
- `./utils/withResolvers.js` (ext=3, int=0) -> `./src/utils/withResolvers.ts`
- `./uds/udsMessaging.js` (ext=3, int=0) -> `./src/uds/udsMessaging.ts`
- `./betaSessionTracing.js` (ext=2, int=0) -> `./src/betaSessionTracing.ts`
- `./errorIds.js` (ext=2, int=0) -> `./src/errorIds.ts`
- `./errorIds` (ext=2, int=0) -> `./src/errorIds.ts`
- `./uds/udsClient.js` (ext=2, int=0) -> `./src/uds/udsClient.ts`
- `./telemetry/perfettoTracing.js` (ext=2, int=0) -> `./src/telemetry/perfettoTracing.ts`
- `./_deps` (ext=1, int=0) -> `./src/_deps.ts`
- `./slowLoggingTag.js` (ext=1, int=0) -> `./src/slowLoggingTag.ts`
- `./eventLoopStallDetector.js` (ext=1, int=0) -> `./src/eventLoopStallDetector.ts`
- `./sdkHeapDumpMonitor.js` (ext=1, int=0) -> `./src/sdkHeapDumpMonitor.ts`
- `./sessionDataUploader.js` (ext=1, int=0) -> `./src/sessionDataUploader.ts`
- `./aggregates/cleanup.js` (ext=1, int=0) -> `./src/aggregates/cleanup.ts`
- `./aggregates/heatmap.js` (ext=1, int=0) -> `./src/aggregates/heatmap.ts`
- `./aggregates/stats.js` (ext=1, int=0) -> `./src/aggregates/stats.ts`
