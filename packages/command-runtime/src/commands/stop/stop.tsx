/**
 * `/stop` execute body.
 *
 * Mirror of ant 4653.js Df3 + 4652.js _j6 — when run inside a bg session
 * (CLAUDE_CODE_SESSION_KIND=bg), persist the job's meta.json with
 * status=stopped and trigger graceful shutdown so the tmux client
 * detaches and the worker process exits.
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
): Promise<React.ReactNode> {
  if (!isBgSession()) {
    onDone('/stop is only available inside a background session.', {
      display: 'system',
    })
    return null
  }

  // ant 4652.js _j6 writes status='stopped' to meta.json BEFORE exiting,
  // so the tasks panel and `ccb ps` reflect user intent immediately
  // rather than waiting for the daemon's next adopt sweep. Mirror.
  const short = process.env.CLAUDE_CODE_BG_JOB_SHORT
  if (short) {
    try {
      // Route through @claude-code/cli/bg.js (which already depends on
      // daemon) instead of pulling daemon directly into command-runtime.
      // Stays under the cross-package-coupling budget.
      const { markJobStopped } = await import('@claude-code/cli/bg.js')
      markJobStopped?.(short)
    } catch {
      // best-effort — fall through to graceful shutdown anyway.
    }
  }

  logEvent('tengu_bg_agent_action', {
    action: 'stop',
    source: 'stop_command',
  })
  onDone('Session stopped.')
  await gracefulShutdown(0, 'prompt_input_exit')
  return null
}
