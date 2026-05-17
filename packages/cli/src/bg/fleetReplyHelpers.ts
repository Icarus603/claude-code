/**
 * cli-side helpers invoked by FleetView when replying to a paused
 * background worker. Two paths:
 *
 *   1. `ptySockReply` — direct pty.sock fallback for PTY-only
 *      deployments (no daemon). Caller uses this when
 *      replyToFleetJob returns ENOCONN. ptyHost accepts the same
 *      'reply' ctrl frame as 'claim' — bracketed-paste + CR injection.
 *      ccb-specific; ant always has a daemon.
 *
 *   2. `respawnFleetJobWithPrompt` — re-spawn the worker with the
 *      reply text as the new initial prompt. Caller uses this when
 *      replyToFleetJob returns ENOWORKER. Source: ant 5092.js gs3
 *      onReply ENOWORKER branch + 4774.js GsH (kZ6).
 *
 * Both helpers live in cli (not agent) because spawnBgPty + the
 * pty.sock transport are cli concerns and agent is core-domain
 * (V7 §3.2 / §8 — keep agent's coupling narrow).
 */

import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { readEnv } from '@claude-code/config/env'
import { getJobDir, readJobState } from '@claude-code/agent/background/fleet/fleetStore.js'

import { spawnBgPty } from '../bg.js'
import { encodeCtrlFrame } from './ptyFrame.js'

export type RespawnOutcome =
  | { ok: true; short: string }
  | { ok: false; error: string }

// --- ptySockReply ----------------------------------------------------------

export async function ptySockReply(short: string, text: string): Promise<boolean> {
  try {
    const sockPath = join(getJobDir(short), 'pty.sock')
    if (!existsSync(sockPath)) return false
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

// --- respawnFleetJobWithPrompt --------------------------------------------

/**
 * GsH (kZ6) builds:
 *   w = $.resumeSessionId ?? K.sessionId
 *   j = path.join(history, `${w}.jsonl`)
 *   J = await qOH(j)
 *   M = _?.initialPrompt ?? (J ? undefined : K.intent)
 *   D = $.respawnFlags.length > 0 ? $.respawnFlags
 *       : K.routine ? ["--routine", K.routine]
 *       : K.template !== "bg" ? ["--agent", K.template]
 *       : []
 *   f = [...(J ? ["--resume", w] : []), ...D, ...(M ? ["--", M] : [])]
 *   ...spawn worker with args f, cwd=K.cwd...
 *
 * ccb's PTY-only mode doesn't have a daemon to do respawn, so this
 * helper does it directly via spawnBgPty. The reply text becomes the
 * worker's first prompt (Commander's [prompt] positional → REPL
 * pre-seeds PromptInput → auto-submits on mount).
 */
function historyDir(cwd: string): string {
  const root = readEnv('CLAUDE_CONFIG_HOME') ?? join(homedir(), '.claude')
  // ant I2(): replace path separators with `-`.
  const slug = cwd.replace(/[/\\]/g, '-').replace(/^-/, '-')
  return join(root, 'projects', slug)
}

export async function respawnFleetJobWithPrompt(
  short: string,
  initialPrompt: string,
): Promise<RespawnOutcome> {
  try {
    const state = await readJobState(getJobDir(short))
    if (state === null) {
      return { ok: false, error: "that job's saved state is missing" }
    }
    // Source: ant GsH `w = $.resumeSessionId ?? K.sessionId`.
    const resumeSessionId = state.resumeSessionId ?? state.sessionId
    // Source: ant GsH `J = await qOH(j)` — does the transcript jsonl exist?
    const transcript = join(historyDir(state.cwd), `${resumeSessionId}.jsonl`)
    const hasTranscript = existsSync(transcript)
    // Source: ant GsH `D = ...respawnFlags / routine / template`.
    let flags: string[] = []
    if (state.respawnFlags !== undefined && state.respawnFlags.length > 0) {
      flags = [...state.respawnFlags]
    } else if (state.template !== 'bg' && state.template !== undefined) {
      flags = ['--agent', state.template]
    }
    // Source: ant GsH `f = [...J ? ["--resume", w] : [], ...D, ...]`.
    const finalFlags: string[] = []
    if (hasTranscript) {
      finalFlags.push('--resume', resumeSessionId)
    }
    finalFlags.push(...flags)
    // Spawn the new worker. The initialPrompt becomes the worker's
    // directive (Commander positional → REPL initial prompt → auto-submit).
    const r = await spawnBgPty({
      flags: finalFlags,
      directive: initialPrompt,
      cwd: state.cwd,
      short,
      // Wait briefly for pty.sock so the caller can attach right away.
      waitForSocketMs: 3_000,
      quiet: true,
    })
    return { ok: true, short: r.short }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
