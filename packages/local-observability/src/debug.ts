// Thin alias — canonical owner is src/utils/debug.ts. The debug state holds
// module-level singletons (memoized filters, buffered writer map) that must
// stay a process-wide singleton, so packages/* MUST go through this alias
// (not duplicate the state).
// eslint-disable-next-line no-restricted-imports
export {
  type DebugLogLevel,
  getMinDebugLogLevel,
  isDebugMode,
  enableDebugLogging,
  getDebugFilter,
  isDebugToStdErr,
  getDebugFilePath,
  setHasFormattedOutput,
  getHasFormattedOutput,
  flushDebugLogs,
  logForDebugging,
  getDebugLogPath,
  logAntError,
} from 'src/utils/debug.js'
