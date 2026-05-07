import type { Command } from '../../runtime.js'

/**
 * `/background` (alias `/bg`) — convert this session into a background
 * job and free the terminal. Mirrors ant v2.1.131 4652.js (jf3 / wf3) +
 * 4650.js (Tf3 / ew6 / Hj6).
 *
 * Behavior:
 *   - In a regular REPL: spawn a `ccb -p "<continue prompt>"` child via
 *     spawnBgJob, persist its meta.json, then gracefulShutdown the
 *     current session (the user's terminal returns to the shell; the
 *     forked job continues independently).
 *   - In an existing bg session: short-circuit to gracefulShutdown
 *     ("already in bg") matching ant Tf3:254.
 *
 * Always enabled (ant matches: `isEnabled: () => true`).
 */
const background = {
  type: 'local-jsx',
  name: 'background',
  aliases: ['bg'],
  description: 'Continue this session in the background and free the terminal',
  argumentHint: '[directive]',
  isEnabled: () => true,
  load: () => import('./background.js'),
} satisfies Command

export default background
