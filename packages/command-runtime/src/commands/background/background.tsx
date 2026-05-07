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

  let short: string | undefined
  try {
    const { spawnBgJob } = await import('@claude-code/cli/bg.js')
    short = await spawnBgJob({
      flags,
      directive,
      cwd: process.cwd(),
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

  onDone(`Backgrounded as ${short}. The original session is exiting.`)
  await gracefulShutdown(0, 'prompt_input_exit')
  return null
}
