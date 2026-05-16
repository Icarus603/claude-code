/**
 * Spawn a fresh FleetJob from a dispatch query.
 *
 * Source: ant dispatch path (5092.js:3700-3800ish, via `kZ6` respawn
 * helper + the daemon spawn op). The high-level shape: build a
 * dispatch envelope, call `daemonSpawn` (or `daemonDispatch` if we have
 * a pre-built spool file), then await ACK to confirm the worker came up.
 *
 * Reuses the existing CLI bg-dispatch infrastructure rather than
 * re-implementing it.
 */

import {
  daemonSpawn,
  daemonAwaitAck,
} from '@claude-code/cli/bg/daemonAdapter.js'
import type { Response as DaemonResponse } from '@claude-code/daemon/daemonClient.js'

export interface FleetDispatchPayload {
  intent: string
  agent: string
  template?: string
  cwd: string
  worktreePath?: string
  routine?: string
  name?: string
  initialPrompt?: string
  /** Nonce that ties the spawn to a subsequent await-ack call. */
  nonce: string
}

export interface FleetDispatchResult {
  ok: true
  short: string
  sessionId: string
}

export type FleetDispatchOutcome = FleetDispatchResult | { ok: false; error: string }

/**
 * Spawn a fleet job + wait for ACK. Returns the short id + session id
 * on success or a typed failure on error.
 *
 * Source: ant kZ6 (5092.js:377-382) spawn-then-await pattern.
 */
export async function dispatchFleetJob(
  payload: FleetDispatchPayload,
): Promise<FleetDispatchOutcome> {
  const spawn = await daemonSpawn(payload as unknown as Parameters<typeof daemonSpawn>[0])
  if (spawn.ok === false) {
    return { ok: false, error: spawn.error ?? 'daemon spawn failed' }
  }
  const short = extractString(spawn, 'short')
  if (short === undefined) return { ok: false, error: 'spawn response missing short' }

  const ack = await daemonAwaitAck({ short, nonce: payload.nonce })
  if (ack.ok === false) {
    return { ok: false, error: ack.error ?? 'await-ack failed' }
  }
  const sessionId = extractString(ack, 'sessionId') ?? short
  return { ok: true, short, sessionId }
}

function extractString(response: DaemonResponse, key: string): string | undefined {
  if (response.ok === false) return undefined
  const v = (response as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}
