/**
 * Send a user reply to a paused FleetJob via the daemon's `reply` op.
 *
 * Source: ant 5092.js:3568-3606 (the daemonReply call inside the peek
 * panel submit handler). Retries up to 10× @ 200ms on transient daemon
 * states (ESTARTING / ENOREPLY). Caller chooses respawn fallback when
 * daemon reports `WsH`/`hg8` ("no live worker").
 */

import { daemonRequest } from '@claude-code/daemon/daemonClient.js'

const REPLY_RETRY_MAX = 10
const REPLY_RETRY_DELAY_MS = 200
const TRANSIENT_CODES = new Set(['ESTARTING', 'ENOREPLY'])

export type FleetReplyOutcome =
  | { ok: true }
  | { ok: false; code: 'ENOWORKER' | 'ETIMEOUT' | 'ENOCONN' | 'EUNKNOWN'; error: string }

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Reply to a paused worker. On transient daemon states retries quietly;
 * on terminal failure returns a typed outcome so the caller (peek-panel
 * submit) can decide whether to respawn the worker with the reply as
 * the new initial prompt.
 *
 * Source: ant 5092.js:3568-3603.
 */
export async function replyToFleetJob(
  short: string,
  text: string,
): Promise<FleetReplyOutcome> {
  let lastError = 'reply did not complete'

  for (let attempt = 0; attempt < REPLY_RETRY_MAX; attempt++) {
    const response = await daemonRequest('reply', { short, text })
    if (response.ok === true) return { ok: true }

    const code = (response as { code?: string }).code ?? ''
    lastError = response.error ?? 'unknown daemon error'

    if (TRANSIENT_CODES.has(code)) {
      await sleep(REPLY_RETRY_DELAY_MS)
      continue
    }
    if (code === 'ENOJOB' || code === 'EALIVE') {
      return { ok: false, code: 'ENOWORKER', error: lastError }
    }
    if (code === 'ETIMEOUT') {
      return { ok: false, code: 'ETIMEOUT', error: lastError }
    }
    if (code === 'ENOCONN') {
      return { ok: false, code: 'ENOCONN', error: lastError }
    }
    return { ok: false, code: 'EUNKNOWN', error: lastError }
  }

  return { ok: false, code: 'ETIMEOUT', error: lastError }
}
