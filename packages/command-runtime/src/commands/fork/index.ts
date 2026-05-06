import { isForkSubagentEnabled } from '@claude-code/tool-registry/tools/AgentTool/forkSubagent.js'
import type { Command } from '../../runtime.js'

/**
 * `/fork <directive>` — spawn an in-process background agent that inherits
 * the full conversation context. The fork runs on the Node event loop in
 * fire-and-forget mode (not an OS subprocess); the parent REPL is free to
 * keep accepting input. When the fork completes, a task-notification
 * message is enqueued back to the parent so the next turn sees the result.
 *
 * Mirrors ant v2.1.131 4659.js (Rf3) — the slash command form of the
 * fork-subagent spawn. The build-time FORK_SUBAGENT flag selects whether
 * this entire command module loads at all (commandRegistryRuntime.ts);
 * `isForkSubagentEnabled()` here adds the runtime gates that ant's `dL`
 * applies on top — coordinator mode and -p non-interactive sessions are
 * both excluded.
 *
 * The actual spawn machinery is reused from AgentTool's fork path:
 * `registerAsyncAgent` + `runAsyncAgentLifecycle` +
 * `runAgent({ forkContextMessages, useExactTools: true, isAsync: true })`.
 *
 * For OS-level background sessions that survive the parent REPL exiting,
 * see `--bg` / `claude ps`/`logs`/`attach` (Phase B, separate path).
 */
const fork = {
  type: 'local-jsx',
  name: 'fork',
  description: 'Spawn a background agent that inherits the full conversation',
  argumentHint: '<directive>',
  isEnabled: () => isForkSubagentEnabled(),
  load: () => import('./fork.js'),
} satisfies Command

export default fork
