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
  // ant 4652.js _j6 — emit agent-action telemetry; the worker's
  // meta.json is reconciled by the daemon's adopt sweep (status moves
  // to 'exited' from the settled handler). The user-visible "Session
  // stopped." string here is enough for the immediate UX; tasks-panel
  // reflects the new state on the next sweep.
  logEvent('tengu_bg_agent_action', {
    action: 'stop',
    source: 'stop_command',
  })
  onDone('Session stopped.')
  await gracefulShutdown(0, 'prompt_input_exit')
  return null
}
