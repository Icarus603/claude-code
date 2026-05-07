/**
 * `/background` execute body.
 *
 * Mirror of ant 4650.js Tf3 + ew6 — convert the running interactive
 * session into a background job. The original REPL exits gracefully
 * (the terminal returns to the shell); a child `ccb -p "<directive>"`
 * is spawned in the same cwd, with its meta.json persisted under
 * ~/.claude/jobs/<short>/.
 *
 * If we're already inside a bg session (CLAUDE_CODE_SESSION_KIND=bg),
 * fall through to gracefulShutdown without spawning anything — this
 * mirrors ant Tf3 line 254 (`if (E7()) ...g7H()...`).
 *
 * @dynamicRequire
 */

import * as React from 'react'

import { logEvent } from '@claude-code/local-observability'

import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import { isBgSession } from '@claude-code/agent/concurrentSessions.js'
import { gracefulShutdown } from '@claude-code/app-host/bootstrap/gracefulShutdown.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args: string,
): Promise<React.ReactNode> {
  // Already in a bg session — ant Tf3:254 short-circuit.
  if (isBgSession()) {
    logEvent('tengu_bg_agent_action', {
      action: 'stop',
      source: 'background_command_already_bg',
    })
    onDone('Already running in the background — exiting.')
    await gracefulShutdown(0, 'prompt_input_exit')
    return null
  }

  const directive = (args ?? '').trim() || 'continue'

  // ant 4650.js ew6 inherits parent context via --resume <session-id>
  // --fork-session. Without these flags, the bg job starts blank and
  // loses the conversation the user wants backgrounded. Mirror.
  const flags: string[] = []
  try {
    const { getSessionId } = await import(
      '@claude-code/app-host/bootstrap/state.js'
    )
    const sessionId = getSessionId()
    if (sessionId) flags.push('--resume', String(sessionId), '--fork-session')
  } catch {
    // best-effort — fall through to a blank session if state lookup fails.
  }

  // ant 4650.js ew6:96-104 — worktree handoff. If the original REPL
  // is running inside a swarm worktree session, propagate the worktree
  // path so the bg child enters the same worktree (matches ant
  // `worktree: { path, branch, hookBased, originCwd }` envelope).
  // The bg child sees these via --add-dir + the swarm hooks restore
  // the rest from session metadata.
  let cwd = process.cwd()
  let hadWorktree = false
  let handedOff = false
  try {
    const { getCurrentWorktreeSession } = await import('@claude-code/swarm')
    const wt = getCurrentWorktreeSession()
    if (wt) {
      hadWorktree = true
      // ant `enteredExisting` distinction: if the user resumed into an
      // existing worktree (creationDurationMs unset), the supervisor
      // hands the same worktree off rather than letting the bg child
      // re-create it.
      handedOff = wt.creationDurationMs === undefined
      cwd = wt.worktreePath
      // --add-dir grants access; the worktree itself is already on
      // disk so we don't need to re-run create_worktree machinery.
      flags.push('--add-dir', wt.worktreePath)
    }
  } catch {
    // worktree package is optional / could be feature-gated. Fall
    // through with the original cwd — the bg job still works, just
    // without worktree continuity.
  }

  let short: string | undefined
  try {
    const { spawnBgJob } = await import('@claude-code/cli/bg.js')
    short = await spawnBgJob({
      flags,
      directive,
      cwd,
    })
  } catch (e) {
    onDone(`Couldn't background — ${(e as Error).message}`, {
      display: 'system',
    })
    return null
  }

  logEvent('tengu_bg_agent_action', {
    action: 'spawn',
    source: 'background_command',
  })
  // ant 4650.js Tf3:172 — extra telemetry mirror for the slash-command
  // path (vs the --bg flag path). Tracks worktree handoff behavior.
  logEvent('tengu_background_fork', {
    confirmed: 'true',
    inflight_count: '0',
    had_prompt: directive !== 'continue' ? 'true' : 'false',
    had_worktree: String(hadWorktree),
    worktree_handed_off: String(handedOff),
  })

  const handoffMsg = handedOff ? ' (worktree handed off)' : ''
  onDone(
    `Backgrounded as ${short}${handoffMsg}. The original session is exiting.`,
  )
  await gracefulShutdown(0, 'prompt_input_exit')
  return null
}
