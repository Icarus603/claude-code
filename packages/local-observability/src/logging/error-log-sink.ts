/**
 * V7 §8.12 — error-log-sink: file-backed implementation for the ErrorLogSink
 * contract declared in ./error-log.ts.
 *
 * Moved from src/utils/errorLogSink.ts. Heavy-weight (axios, buffered writers,
 * cleanup registry) and only initialized during app startup — hence separated
 * from ./error-log.ts which must stay dep-free so log calls before startup
 * can be safely queued.
 *
 * Cross-package deps (direct imports): fs from storage/fsOperations,
 * cache paths from storage/cache-paths, session id + cleanup registry
 * from app-host/bootstrap, debug logger + sentry from this package.
 */

import axios from 'axios'
import { dirname, join } from 'path'

import { getSessionId } from '@claude-code/app-host/bootstrap/state.js'
import { registerCleanup } from '@claude-code/app-host/bootstrap/cleanupRegistry.js'
import { CACHE_PATHS } from '@claude-code/storage/cache-paths'
import { getFsImplementation } from '@claude-code/storage/fsOperations.js'

import { captureException } from '../sentry.js'
import { logForDebugging } from '../debug.js'
import { jsonStringify } from '../slowOperations.js'

// Local shim wrapping CACHE_PATHS into the lazy-call shape this module
// expects (callers do `getCachePaths().errors()` not `CACHE_PATHS.errors()`).
const getCachePaths = (): { errors(): string; mcpLogs(serverName: string): string } => ({
  errors: () => CACHE_PATHS.errors(),
  mcpLogs: (serverName: string) => CACHE_PATHS.mcpLogs(serverName),
})
import { attachErrorLogSink, dateToFilename } from './error-log.js'

const DATE = dateToFilename(new Date())

/**
 * Gets the path to the errors log file.
 */
export function getErrorsPath(): string {
  return join(getCachePaths().errors(), DATE + '.jsonl')
}

/**
 * Gets the path to MCP logs for a server.
 */
export function getMCPLogsPath(serverName: string): string {
  return join(getCachePaths().mcpLogs(serverName), DATE + '.jsonl')
}

// ---------------------------------------------------------------------------
// Buffered JSONL writer (inlined minimal implementation)
// ---------------------------------------------------------------------------

type JsonlWriter = {
  write: (obj: object) => void
  flush: () => void
  dispose: () => void
}

type BufferedWriterOptions = {
  writeFn: (content: string) => void
  flushIntervalMs?: number
  maxBufferSize?: number
}

/**
 * Minimal buffered writer — groups writes to reduce syscall overhead.
 * Previously imported from src/utils/bufferedWriter.ts. Small enough
 * to inline here so local-observability stays src/-free.
 */
function createBufferedWriter(options: BufferedWriterOptions): JsonlWriter {
  const { writeFn, flushIntervalMs = 1000, maxBufferSize = 50 } = options
  let buffer: string[] = []
  let timer: NodeJS.Timeout | null = null
  let disposed = false

  function flush(): void {
    if (buffer.length === 0) return
    const content = buffer.join('')
    buffer = []
    try {
      writeFn(content)
    } catch {
      // Silently fail — logging must never throw
    }
  }

  function scheduleFlush(): void {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      flush()
    }, flushIntervalMs)
  }

  return {
    write(obj: object): void {
      if (disposed) return
      buffer.push(jsonStringify(obj) + '\n')
      if (buffer.length >= maxBufferSize) {
        flush()
      } else {
        scheduleFlush()
      }
    },
    flush,
    dispose(): void {
      disposed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      flush()
    },
  }
}

function createJsonlWriter(options: BufferedWriterOptions): JsonlWriter {
  return createBufferedWriter(options)
}

// ---------------------------------------------------------------------------
// Log writer pool
// ---------------------------------------------------------------------------

const logWriters = new Map<string, JsonlWriter>()

/**
 * Flush all buffered log writers. Used for testing.
 * @internal
 */
export function _flushLogWritersForTesting(): void {
  for (const writer of logWriters.values()) {
    writer.flush()
  }
}

/**
 * Clear all buffered log writers. Used for testing.
 * @internal
 */
export function _clearLogWritersForTesting(): void {
  for (const writer of logWriters.values()) {
    writer.dispose()
  }
  logWriters.clear()
}

function getLogWriter(path: string): JsonlWriter {
  let writer = logWriters.get(path)
  if (!writer) {
    const dir = dirname(path)
    writer = createJsonlWriter({
      writeFn: (content: string) => {
        try {
          getFsImplementation().appendFileSync(path, content)
        } catch {
          getFsImplementation().mkdirSync(dir)
          getFsImplementation().appendFileSync(path, content)
        }
      },
      flushIntervalMs: 1000,
      maxBufferSize: 50,
    })
    logWriters.set(path, writer)
    registerCleanup(async () => writer?.dispose())
  }
  return writer
}

function appendToLog(path: string, message: object): void {
  if (process.env.USER_TYPE !== 'ant') return

  const messageWithTimestamp = {
    timestamp: new Date().toISOString(),
    ...message,
    cwd: process.cwd(),
    userType: process.env.USER_TYPE,
    sessionId: getSessionId(),
    version: MACRO.VERSION,
  }

  getLogWriter(path).write(messageWithTimestamp)
}

function extractServerMessage(data: unknown): string | undefined {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (
      typeof obj.error === 'object' &&
      obj.error &&
      'message' in obj.error &&
      typeof (obj.error as Record<string, unknown>).message === 'string'
    ) {
      return (obj.error as Record<string, unknown>).message as string
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Sink implementations
// ---------------------------------------------------------------------------

function logErrorImpl(error: Error): void {
  const errorStr = error.stack || error.message

  let context = ''
  if (axios.isAxiosError(error) && error.config?.url) {
    const parts = [`url=${error.config.url}`]
    if (error.response?.status !== undefined) {
      parts.push(`status=${error.response.status}`)
    }
    const serverMessage = extractServerMessage(error.response?.data)
    if (serverMessage) {
      parts.push(`body=${serverMessage}`)
    }
    context = `[${parts.join(',')}] `
  }

  logForDebugging(`${error.name}: ${context}${errorStr}`, { level: 'error' })

  appendToLog(getErrorsPath(), {
    error: `${context}${errorStr}`,
  })

  captureException(error)
}

function logMCPErrorImpl(serverName: string, error: unknown): void {
  logForDebugging(`MCP server "${serverName}" ${error}`, { level: 'error' })

  const logFile = getMCPLogsPath(serverName)
  const errorStr =
    error instanceof Error ? error.stack || error.message : String(error)

  getLogWriter(logFile).write({
    error: errorStr,
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
    cwd: process.cwd(),
  })
}

function logMCPDebugImpl(serverName: string, message: string): void {
  logForDebugging(`MCP server "${serverName}": ${message}`)

  getLogWriter(getMCPLogsPath(serverName)).write({
    debug: message,
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
    cwd: process.cwd(),
  })
}

/**
 * Initialize the error log sink.
 *
 * Call this during app startup to attach the error logging backend.
 * Any errors logged before this is called will be queued and drained.
 *
 * Should be called BEFORE initializeAnalyticsSink() in the startup sequence.
 *
 * Idempotent: safe to call multiple times (subsequent calls are no-ops).
 */
export function initializeErrorLogSink(): void {
  attachErrorLogSink({
    logError: logErrorImpl,
    logMCPError: logMCPErrorImpl,
    logMCPDebug: logMCPDebugImpl,
    getErrorsPath,
    getMCPLogsPath,
  })

  logForDebugging('Error log sink initialized')
}
