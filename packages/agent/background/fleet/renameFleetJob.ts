/**
 * Rename a FleetJob (update the display name and persist).
 *
 * Source: ant zAH (2507.js:180-196).
 *
 * Two write paths:
 *   - The current foreground session: rename via the in-process job
 *     dir (CLAUDE_JOB_DIR env or short(8) of session id).
 *   - A peer (background) session: write directly to that session's
 *     state.json.
 *
 * Respects nameSource — if source==="auto" and the job already has a
 * user-set name, the rename is a no-op (don't overwrite manual edits).
 */

import { readEnv } from '@claude-code/config/env'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { getJobDir, invalidateCache, readJobState, writeJobState } from './fleetStore.js'
import type { FleetNameSource } from './fleetTypes.js'

function getCurrentJobDir(currentSessionId: string, requestedSessionId: string): string {
  if (currentSessionId === requestedSessionId) {
    const envDir = readEnv('CLAUDE_JOB_DIR')
    if (envDir !== undefined) return envDir
    return getJobDir(currentSessionId.slice(0, 8))
  }
  return getJobDir(requestedSessionId.slice(0, 8))
}

/**
 * Source: ant zAH. Returns `true` if rename applied (or was a no-op
 * because the name already matched). Returns `false` only on hard
 * errors that should surface to the user.
 */
export async function renameFleetJob(
  currentSessionId: string,
  sessionId: string,
  newName: string,
  source: FleetNameSource,
): Promise<boolean> {
  const jobDir = getCurrentJobDir(currentSessionId, sessionId)
  const initial = await readJobState(jobDir)
  if (initial === null) return false

  const isCurrent = currentSessionId === sessionId
  if (!isCurrent && initial.sessionId !== sessionId) return false
  if (initial.name === newName) return true

  invalidateCache(jobDir)
  const fresh = (await readJobState(jobDir)) ?? initial

  if (!isCurrent && fresh.sessionId !== sessionId) return false
  if (fresh.name === newName) return true
  if (source === 'auto' && fresh.name !== undefined && fresh.name !== '') return true

  try {
    await writeJobState(jobDir, {
      ...fresh,
      name: newName,
      nameSource: source,
      updatedAt: new Date().toISOString(),
    })
    return true
  } catch (err) {
    logForDebugging(`[fleet] rename ${sessionId.slice(0, 8)}: ${(err as Error).message}`, { level: 'warn' })
    return false
  }
}
