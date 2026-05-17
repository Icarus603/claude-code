/**
 * Respawn a FleetJob whose worker has exited, using the user's reply as
 * the new initial prompt.
 *
 * Source: ant 5092.js gs3 onReply ENOWORKER branch + 4774.js GsH:
 *
 *   onReply: async (W_) => {
 *     ...
 *     if (l6 = await cP6(E9.id, W_, E9.state),
 *         l6 === WsH && zG(W_) === "prompt") {
 *       let K9 = await kZ6(E9.id, {knownState: E9.state, initialPrompt: W_});
 *       Dq = !K9.ok;
 *       l6 = K9.ok ? null : K9.error;
 *     }
 *     ...
 *   }
 *
 *   GsH (kZ6) builds:
 *     w = $.resumeSessionId ?? K.sessionId
 *     j = path.join(history, `${w}.jsonl`)
 *     J = await qOH(j)
 *     M = _?.initialPrompt ?? (J ? undefined : K.intent)
 *     D = $.respawnFlags.length > 0 ? $.respawnFlags
 *         : K.routine ? ["--routine", K.routine]
 *         : K.template !== "bg" ? ["--agent", K.template]
 *         : []
 *     f = [...(J ? ["--resume", w] : []), ...D, ...(M ? ["--", M] : [])]
 *     ...spawn worker with args f, cwd=K.cwd...
 *
 * ccb's PTY-only mode doesn't have a daemon to do respawn, so this
 * helper does it directly via spawnBgPty. The reply text becomes the
 * worker's first prompt (Commander's [prompt] positional → REPL
 * pre-seeds PromptInput → auto-submits on mount).
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { readJobState } from './fleetStore.js'

export type RespawnOutcome =
  | { ok: true; short: string }
  | { ok: false; error: string }

function getJobDir(short: string): string {
  const root = process.env.CLAUDE_CONFIG_HOME ?? join(homedir(), '.claude')
  return join(root, 'jobs', short)
}

function historyDir(cwd: string): string {
  const root = process.env.CLAUDE_CONFIG_HOME ?? join(homedir(), '.claude')
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
    const { spawnBgPty } = await import('@claude-code/cli/bg.js')
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
