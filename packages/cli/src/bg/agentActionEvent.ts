/**
 * Helper for tengu_bg_agent_action telemetry — used by every user-facing
 * bg verb (stop/kill/respawn/attach/rm). ant 4649.js / 4652.js patterns.
 *
 * Extracted from bg.ts to keep that file under its 800 LOC budget.
 *
 * @dynamicRequire
 */
import { logEvent } from '@claude-code/local-observability'

export type AgentAction = 'stop' | 'kill' | 'respawn' | 'attach' | 'rm' | 'spawn'

export function emitAgentAction(
  action: AgentAction,
  short?: string,
  extra: Record<string, string> = {},
): void {
  logEvent('tengu_bg_agent_action', {
    action,
    ...(short && { short }),
    ...extra,
  })
}
