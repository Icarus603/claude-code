/**
 * V7 §10.3 facade — the error-logging surface (`logError`, `logMCPError`,
 * `logMCPDebug`, `attachErrorLogSink`, `getInMemoryErrors`, `dateToFilename`,
 * `captureAPIRequest`, `_resetErrorLogForTesting`) now lives in
 * `@claude-code/local-observability/logging`.
 *
 * This file keeps:
 *   - re-exports from the owner package (so 148+ call sites don't need touching)
 *   - the `LogOption` display/list helpers (`getLogDisplayTitle`, `loadErrorLogs`,
 *     `getErrorLogByIndex`) which depend on storage/fileHistory types and
 *     are not observability concerns. They'll move with storage later.
 *
 * Do not add new logic here — add it in packages/local-observability/.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'

import {
  _resetErrorLogForTesting,
  attachErrorLogSink,
  captureAPIRequest,
  dateToFilename,
  getInMemoryErrors,
  logError,
  logMCPDebug,
  logMCPError,
  type ErrorLogSink,
} from './logging/index.js'

import { TICK_TAG } from '@claude-code/command-runtime/xml.js'
import { type LogOption, type SerializedMessage, sortLogs } from '@claude-code/agent/logsTypes.js'
import { CACHE_PATHS } from '@claude-code/storage/cache-paths'
import { stripDisplayTags, stripDisplayTagsAllowEmpty } from '@claude-code/output/utils/displayTags.js'
import { jsonParse } from './slowOperations.js'

// ---------------------------------------------------------------------------
// Re-exports of the owner-package API — preserves every external call site
// that still imports from `src/utils/log.js` / relative paths.
// ---------------------------------------------------------------------------

export {
  _resetErrorLogForTesting,
  attachErrorLogSink,
  captureAPIRequest,
  dateToFilename,
  getInMemoryErrors,
  logError,
  logMCPDebug,
  logMCPError,
}
export type { ErrorLogSink }

// ---------------------------------------------------------------------------
// Display / list helpers — stay here because they depend on LogOption which
// pulls in storage + fileHistory types. Will move with storage (Wave 2).
// ---------------------------------------------------------------------------

/**
 * Gets the display title for a log/session with fallback logic.
 * Skips firstPrompt if it starts with a tick/goal tag (autonomous mode auto-prompt).
 * Strips display-unfriendly tags (like <ide_opened_file>) from the result.
 * Falls back to a truncated session ID when no other title is available.
 */
export function getLogDisplayTitle(
  log: LogOption,
  defaultTitle?: string,
): string {
  const isAutonomousPrompt = log.firstPrompt?.startsWith(`<${TICK_TAG}>`)
  const strippedFirstPrompt = log.firstPrompt
    ? stripDisplayTagsAllowEmpty(log.firstPrompt)
    : ''
  const useFirstPrompt = strippedFirstPrompt && !isAutonomousPrompt
  const title =
    log.agentName ||
    log.customTitle ||
    log.summary ||
    (useFirstPrompt ? strippedFirstPrompt : undefined) ||
    defaultTitle ||
    (isAutonomousPrompt ? 'Autonomous session' : undefined) ||
    (log.sessionId ? log.sessionId.slice(0, 8) : '') ||
    ''
  return stripDisplayTags(title).trim()
}

/**
 * Loads the list of error logs.
 */
export function loadErrorLogs(): Promise<LogOption[]> {
  return loadLogList(CACHE_PATHS.errors())
}

/**
 * Gets an error log by its index.
 */
export async function getErrorLogByIndex(
  index: number,
): Promise<LogOption | null> {
  const logs = await loadErrorLogs()
  return logs[index] || null
}

async function loadLogList(path: string): Promise<LogOption[]> {
  let files: Awaited<ReturnType<typeof readdir>>
  try {
    files = (await readdir(path, { withFileTypes: true })) as any
  } catch {
    logError(new Error(`No logs found at ${path}`))
    return []
  }
  const logData = await Promise.all(
    files.map(async (file, i) => {
      const fullPath = join(path, String(file.name))
      const content = await readFile(fullPath, { encoding: 'utf8' })
      const messages = jsonParse(content) as SerializedMessage[]
      const firstMessage = messages[0]
      const lastMessage = messages[messages.length - 1]
      const firstPrompt =
        firstMessage?.type === 'user' &&
        typeof firstMessage?.message?.content === 'string'
          ? firstMessage?.message?.content
          : 'No prompt'

      const fileStats = await stat(fullPath)
      const isSidechain = fullPath.includes('sidechain')
      const date = dateToFilename(fileStats.mtime)

      return {
        date,
        fullPath,
        messages,
        value: i,
        created: parseISOString(firstMessage?.timestamp || date),
        modified: lastMessage?.timestamp
          ? parseISOString(lastMessage.timestamp)
          : parseISOString(date),
        firstPrompt:
          firstPrompt.split('\n')[0]?.slice(0, 50) +
            (firstPrompt.length > 50 ? '…' : '') || 'No prompt',
        messageCount: messages.length,
        isSidechain,
      }
    }),
  )

  return sortLogs(logData.filter(_ => _ !== null)).map((_, i) => ({
    ..._,
    value: i,
  }))
}

function parseISOString(s: string): Date {
  const b = s.split(/\D+/)
  return new Date(
    Date.UTC(
      parseInt(b[0]!, 10),
      parseInt(b[1]!, 10) - 1,
      parseInt(b[2]!, 10),
      parseInt(b[3]!, 10),
      parseInt(b[4]!, 10),
      parseInt(b[5]!, 10),
      parseInt(b[6]!, 10),
    ),
  )
}
