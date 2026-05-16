/**
 * Send a user reply to a paused FleetJob.
 *
 * Source: ant 5092.js:3568-3606 (the daemonReply call inside the peek
 * panel submit handler). ant's `cP6` always goes through the daemon's
 * `reply` op. ccb's PTY-only deployments have no daemon — we fall back
 * to writing a `t:'reply'` ctrl frame directly to the worker's pty.sock
 * (ptyHost handleCtrl handles 'reply' the same way as 'claim': inject
 * via bracketed paste + CR). Same end-user behaviour, different
 * transport.
 *
 * Retries up to 10× @ 200ms on transient daemon states (ESTARTING /
 * ENOREPLY). Caller chooses respawn fallback when reply reports
 * ENOWORKER ("no live worker").
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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
 * Direct pty.sock fallback for PTY-only deployments (no daemon). Resolves
 * to true when the ctrl frame is flushed to the host, false otherwise.
 */
async function ptySockReplyFallback(
  short: string,
  text: string,
): Promise<boolean> {
  try {
    const root = process.env.CLAUDE_CONFIG_HOME ?? join(homedir(), '.claude')
    const sockPath = join(root, 'jobs', short, 'pty.sock')
    if (!existsSync(sockPath)) return false
    const [{ connect }, { encodeCtrlFrame }] = await Promise.all([
      import('node:net'),
      import('@claude-code/cli/bg/ptyFrame.js'),
    ])
    return await new Promise<boolean>(resolve => {
      const sock = connect(sockPath)
      let settled = false
      const settle = (ok: boolean): void => {
        if (settled) return
        settled = true
        try {
          sock.destroy()
        } catch {
          /* best-effort */
        }
        resolve(ok)
      }
      sock.once('error', () => settle(false))
      sock.once('connect', () => {
        try {
          sock.write(encodeCtrlFrame({ t: 'reply', text }))
          setTimeout(() => settle(true), 50)
        } catch {
          settle(false)
        }
      })
    })
  } catch {
    return false
  }
}

/**
 * Reply to a paused worker. On transient daemon states retries quietly;
 * on terminal failure returns a typed outcome so the caller (peek-panel
 * submit) can decide whether to respawn the worker with the reply as
 * the new initial prompt.
 *
 * Source: ant 5092.js:3568-3603 (daemon path). PTY-sock fallback is
 * ccb-specific — same semantics as ant's reply (inject as bracketed
 * paste + CR) but bypasses the missing daemon.
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
      // PTY-only deployments — try direct pty.sock fallback. ptyHost
      // accepts the same 'reply' ctrl frame as 'claim'; the worker
      // doesn't care whether the reply came via daemon RPC or socket.
      if (await ptySockReplyFallback(short, text)) return { ok: true }
      return { ok: false, code: 'ENOCONN', error: lastError }
    }
    return { ok: false, code: 'EUNKNOWN', error: lastError }
  }

  return { ok: false, code: 'ETIMEOUT', error: lastError }
}
