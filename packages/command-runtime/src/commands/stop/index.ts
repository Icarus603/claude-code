import { isBgSession } from '@claude-code/agent/concurrentSessions.js'
import type { Command } from '../../runtime.js'

/**
 * `/stop` — terminate this background session, preserving transcript and
 * worktree. Mirrors ant v2.1.131 4656.js (ff3 / Xf3) — only enabled when
 * the REPL is running inside a `--bg` session (CLAUDE_CODE_SESSION_KIND=bg).
 *
 * On a regular interactive session this command is hidden (`isEnabled`
 * returns false); on a bg session, calling it persists the worker's
 * meta.json with status=stopped and exits via gracefulShutdown so the
 * tmux client detaches cleanly. ant calls the same `_j6('stop_command')`
 * helper as their `/background` command's "already-bg" branch.
 */
const stop = {
  type: 'local-jsx',
  name: 'stop',
  description:
    'Stop this background session; transcript and worktree are kept',
  isEnabled: () => isBgSession(),
  load: () => import('./stop.js'),
} satisfies Command

export default stop
