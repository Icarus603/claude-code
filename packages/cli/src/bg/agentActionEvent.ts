/**
 * Helpers for tengu_bg_agent_* telemetry — used by every user-facing bg
 * verb (stop/kill/respawn/attach/rm) and the spawn intent capture point.
 * ant 4649.js / 4652.js (action), 3921.js (dispatch / terminal).
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

/**
 * ant 3921.js YB5 — fires when a bg agent captures the user's intent
 * (the directive for `ccb --bg-pty <directive>`). Source defaults to
 * 'shell' but CLAUDE_BG_SOURCE env can override (e.g. for slash-command
 * or fleet-spawned dispatches).
 */
export function emitAgentDispatch(short: string, intent: string): void {
  logEvent('tengu_bg_agent_dispatch', {
    short,
    source: process.env.CLAUDE_BG_SOURCE ?? 'shell',
    intent_length: String(intent.length),
  })
}

/**
 * ant 3921.js — fires when a bg agent enters its terminal state
 * (exited / killed / crashed). Distinct from tengu_bg_settle which
 * is daemon-internal; this one is user-facing-CLI-side and includes
 * duration since spawn.
 */
export function emitAgentTerminal(short: string, outcome: string, durationMs: number): void {
  logEvent('tengu_bg_agent_terminal', {
    short,
    outcome,
    duration_ms: String(durationMs),
  })
}
