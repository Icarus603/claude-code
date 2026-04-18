/**
 * V7 §8.12 — diag-log: `logForDiagnosticsNoPII` + `withDiagnosticsTiming`.
 *
 * Moved from src/utils/diagLogs.ts. Writes diagnostic entries (no PII) to
 * a file pointed to by `$CLAUDE_CODE_DIAGNOSTICS_FILE`. Used by the
 * environment manager to monitor container-side issues.
 */

import { dirname } from 'path'

import { getFsImplementation, jsonStringify } from '../_deps.js'

type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error'

type DiagnosticLogEntry = {
  timestamp: string
  level: DiagnosticLogLevel
  event: string
  data: Record<string, unknown>
}

/**
 * Logs diagnostic information to a logfile. This information is sent
 * via the environment manager to session-ingress to monitor issues from
 * within the container.
 *
 * *Important* - this function MUST NOT be called with any PII, including
 * file paths, project names, repo names, prompts, etc.
 */
export function logForDiagnosticsNoPII(
  level: DiagnosticLogLevel,
  event: string,
  data?: Record<string, unknown>,
): void {
  const logFile = getDiagnosticLogFile()
  if (!logFile) return

  const entry: DiagnosticLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    data: data ?? {},
  }

  const fs = getFsImplementation()
  const line = jsonStringify(entry) + '\n'
  try {
    fs.appendFileSync(logFile, line)
  } catch {
    try {
      fs.mkdirSync(dirname(logFile))
      fs.appendFileSync(logFile, line)
    } catch {
      // Silently fail if logging is not possible
    }
  }
}

function getDiagnosticLogFile(): string | undefined {
  return process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
}

/**
 * Wraps an async function with diagnostic timing logs.
 * Logs `{event}_started` before execution and `{event}_completed` after with duration_ms.
 */
export async function withDiagnosticsTiming<T>(
  event: string,
  fn: () => Promise<T>,
  getData?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const startTime = Date.now()
  logForDiagnosticsNoPII('info', `${event}_started`)

  try {
    const result = await fn()
    const additionalData = getData ? getData(result) : {}
    logForDiagnosticsNoPII('info', `${event}_completed`, {
      duration_ms: Date.now() - startTime,
      ...additionalData,
    })
    return result
  } catch (error) {
    logForDiagnosticsNoPII('error', `${event}_failed`, {
      duration_ms: Date.now() - startTime,
    })
    throw error
  }
}
