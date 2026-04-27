import type { AgentColorName } from '../adapters/appRuntime.js'
import { detectAndGetBackend } from '../backends/registry.js'
import type { PaneBackend } from '../backends/types.js'

// Color assignment moved to ./teammateColors.ts (V7 §11.2 — broke the
// 3-file PaneBackendExecutor → teammateLayoutManager → registry cycle).
// Re-export for backwards compat: external code still imports these
// helpers from teammateLayoutManager.
export {
  assignTeammateColor,
  getTeammateColor,
  clearTeammateColors,
} from './teammateColors.js'

/**
 * Gets the appropriate backend for the current environment.
 * detectAndGetBackend() caches internally — no need for a second cache here.
 */
async function getBackend(): Promise<PaneBackend> {
  return (await detectAndGetBackend()).backend
}

/**
 * Checks if we're currently running inside a tmux session.
 * Uses the detection module directly for this check.
 */
export async function isInsideTmux(): Promise<boolean> {
  const { isInsideTmux: checkTmux } = await import('../backends/detection.js')
  return checkTmux()
}

/**
 * Creates a new teammate pane in the swarm view.
 * Automatically selects the appropriate backend (tmux or iTerm2) based on environment.
 *
 * When running INSIDE tmux:
 * - Uses TmuxBackend to split the current window
 * - Leader stays on left (30%), teammates on right (70%)
 *
 * When running in iTerm2 (not in tmux) with it2 CLI:
 * - Uses ITermBackend for native iTerm2 split panes
 *
 * When running OUTSIDE tmux/iTerm2:
 * - Falls back to TmuxBackend with external claude-swarm session
 */
export async function createTeammatePaneInSwarmView(
  teammateName: string,
  teammateColor: AgentColorName,
): Promise<{ paneId: string; isFirstTeammate: boolean }> {
  const backend = await getBackend()
  return backend.createTeammatePaneInSwarmView(teammateName, teammateColor)
}

/**
 * Enables pane border status for a window (shows pane titles).
 * Delegates to the detected backend.
 */
export async function enablePaneBorderStatus(
  windowTarget?: string,
  useSwarmSocket = false,
): Promise<void> {
  const backend = await getBackend()
  return backend.enablePaneBorderStatus(windowTarget, useSwarmSocket)
}

/**
 * Sends a command to a specific pane.
 * Delegates to the detected backend.
 */
export async function sendCommandToPane(
  paneId: string,
  command: string,
  useSwarmSocket = false,
): Promise<void> {
  const backend = await getBackend()
  return backend.sendCommandToPane(paneId, command, useSwarmSocket)
}
