export {
  TEAM_LEAD_NAME,
  MAILBOX_POLL_INTERVAL_MS,
  PERMISSION_POLL_INTERVAL_MS,
  TEAMMATE_MESSAGES_UI_CAP,
  LOCK_OPTIONS,
  ENV,
} from '../types/constants.js'

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
