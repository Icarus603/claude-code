// Only TEAM_LEAD_NAME is consumed via this barrel; the other 5 exports
// from '../types/constants.js' had no callers and were dropped 2026-04-29.
// Importers that want the dropped constants should reach into
// '../types/constants.js' directly.
export { TEAM_LEAD_NAME } from '../types/constants.js'

export const SWARM_SESSION_NAME = 'claude-swarm'
export const SWARM_VIEW_WINDOW_NAME = 'swarm-view'
export const TMUX_COMMAND = 'tmux'
export const HIDDEN_SESSION_NAME = 'claude-hidden'

export function getSwarmSocketName(): string {
  return `claude-swarm-${process.pid}`
}

export const TEAMMATE_COMMAND_ENV_VAR = 'CLAUDE_CODE_TEAMMATE_COMMAND'
export const TEAMMATE_COLOR_ENV_VAR = 'CLAUDE_CODE_AGENT_COLOR'
export const PLAN_MODE_REQUIRED_ENV_VAR = 'CLAUDE_CODE_PLAN_MODE_REQUIRED'
