/**
 * V7 §8.12 — error-log: the logError / logMCPError / logMCPDebug family.
 *
 * Split out of src/utils/log.ts. Display/list helpers (getLogDisplayTitle,
 * loadErrorLogs, etc.) stay in src/ because they depend on `LogOption`
 * which reaches transitively into storage and fileHistory types.
 *
 * Design: this module contains the `logError` API surface + sink
 * attachment mechanism. It has NO heavy deps — events queue until
 * `attachErrorLogSink()` connects a real sink (see ./error-log-sink.ts).
 *
 * Cross-boundary state (sessionId, lastAPIRequest, privacy flag) comes
 * through setters on `../_deps.ts`.
 */

import { feature } from 'bun:bundle'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import memoize from 'lodash-es/memoize.js'

import {
  callSetLastAPIRequest,
  callSetLastAPIRequestMessages,
  isEnvTruthy,
  isEssentialTrafficOnly,
  toError,
} from '../_deps.js'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * Sink interface for the error logging backend.
 * Implementation lives in ./error-log-sink.ts and is attached on app startup.
 */
export type ErrorLogSink = {
  logError: (error: Error) => void
  logMCPError: (serverName: string, error: unknown) => void
  logMCPDebug: (serverName: string, message: string) => void
  getErrorsPath: () => string
  getMCPLogsPath: (serverName: string) => string
}

type QueuedErrorEvent =
  | { type: 'error'; error: Error }
  | { type: 'mcpError'; serverName: string; error: unknown }
  | { type: 'mcpDebug'; serverName: string; message: string }

// ---------------------------------------------------------------------------
// In-memory error ring buffer — always populated regardless of sink
// ---------------------------------------------------------------------------

const MAX_IN_MEMORY_ERRORS = 100
let inMemoryErrorLog: Array<{ error: string; timestamp: string }> = []

function addToInMemoryErrorLog(errorInfo: {
  error: string
  timestamp: string
}): void {
  if (inMemoryErrorLog.length >= MAX_IN_MEMORY_ERRORS) {
    inMemoryErrorLog.shift()
  }
  inMemoryErrorLog.push(errorInfo)
}

export function getInMemoryErrors(): { error: string; timestamp: string }[] {
  return [...inMemoryErrorLog]
}

// ---------------------------------------------------------------------------
// Sink attachment — idempotent; events queue until sink attaches
// ---------------------------------------------------------------------------

const errorQueue: QueuedErrorEvent[] = []
let errorLogSink: ErrorLogSink | null = null

/**
 * Attach the error log sink that will receive all error events.
 * Queued events are drained immediately to ensure no errors are lost.
 *
 * Idempotent: if a sink is already attached, this is a no-op. This allows
 * calling from both the preAction hook (for subcommands) and setup() (for
 * the default command) without coordination.
 */
export function attachErrorLogSink(newSink: ErrorLogSink): void {
  if (errorLogSink !== null) return
  errorLogSink = newSink

  if (errorQueue.length > 0) {
    const queuedEvents = [...errorQueue]
    errorQueue.length = 0
    for (const event of queuedEvents) {
      switch (event.type) {
        case 'error':
          errorLogSink.logError(event.error)
          break
        case 'mcpError':
          errorLogSink.logMCPError(event.serverName, event.error)
          break
        case 'mcpDebug':
          errorLogSink.logMCPDebug(event.serverName, event.message)
          break
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Date helper (used by error-log-sink for filename stamping)
// ---------------------------------------------------------------------------

export function dateToFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

// ---------------------------------------------------------------------------
// logError / logMCPError / logMCPDebug public API
// ---------------------------------------------------------------------------

const isHardFailMode = memoize((): boolean =>
  process.argv.includes('--hard-fail'),
)

export function logError(error: unknown): void {
  const err = toError(error)
  if (feature('HARD_FAIL') && isHardFailMode()) {
    console.error('[HARD FAIL] logError called with:', err.stack || err.message)
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(1)
  }
  try {
    if (
      isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
      isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
      isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY) ||
      process.env.DISABLE_ERROR_REPORTING ||
      isEssentialTrafficOnly()
    ) {
      return
    }

    const errorStr = err.stack || err.message

    addToInMemoryErrorLog({
      error: errorStr,
      timestamp: new Date().toISOString(),
    })

    if (errorLogSink === null) {
      errorQueue.push({ type: 'error', error: err })
      return
    }

    errorLogSink.logError(err)
  } catch {
    // pass — logging must never throw
  }
}

export function logMCPError(serverName: string, error: unknown): void {
  try {
    if (errorLogSink === null) {
      errorQueue.push({ type: 'mcpError', serverName, error })
      return
    }
    errorLogSink.logMCPError(serverName, error)
  } catch {
    // Silently fail
  }
}

export function logMCPDebug(serverName: string, message: string): void {
  try {
    if (errorLogSink === null) {
      errorQueue.push({ type: 'mcpDebug', serverName, message })
      return
    }
    errorLogSink.logMCPDebug(serverName, message)
  } catch {
    // Silently fail
  }
}

// ---------------------------------------------------------------------------
// captureAPIRequest — stores request params (not messages) for bug reports
// ---------------------------------------------------------------------------

/**
 * Captures the last API request for inclusion in bug reports.
 *
 * Accepts `querySource: unknown` because the QuerySource type lives in
 * `src/constants/querySource.ts` and we don't cross the src/ import
 * boundary. Host callers pass the string; we startsWith-match here.
 */
export function captureAPIRequest(
  params: BetaMessageStreamParams,
  querySource?: unknown,
): void {
  // startsWith, not exact match — users with non-default output styles get
  // variants like 'repl_main_thread:outputStyle:Explanatory' (querySource.ts).
  if (typeof querySource !== 'string') return
  if (!querySource.startsWith('repl_main_thread')) return

  // Store params WITHOUT messages to avoid retaining the entire conversation
  // for all users. Messages are already persisted to the transcript file and
  // available via React state.
  const { messages, ...paramsWithoutMessages } = params
  callSetLastAPIRequest(paramsWithoutMessages)
  callSetLastAPIRequestMessages(process.env.USER_TYPE === 'ant' ? messages : null)
}

// ---------------------------------------------------------------------------
// Testing utility — reset all module state for unit tests
// ---------------------------------------------------------------------------

/**
 * Reset error log state for testing purposes only.
 * @internal
 */
export function _resetErrorLogForTesting(): void {
  errorLogSink = null
  errorQueue.length = 0
  inMemoryErrorLog = []
}
