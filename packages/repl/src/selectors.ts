/**
 * Selectors for deriving computed state from AppState.
 * Keep selectors pure and simple - just data extraction, no side effects.
 */

import type { InProcessTeammateTaskState } from '@claude-code/swarm'
import { isInProcessTeammateTask } from '@claude-code/swarm'

// Minimal structural shapes — the full task/state types still live in src/.
// Selectors here only access a narrow field set; stricter types stay at
// call sites that import from AppStateStore directly.
type LocalAgentTaskState = { type: 'local_agent'; [key: string]: unknown }
type AppStateShape = {
  viewingAgentTaskId: string | null | undefined
  tasks: Record<string, { type: string; [key: string]: unknown }>
}

/**
 * Get the currently viewed teammate task, if any.
 * Returns undefined if:
 * - No teammate is being viewed (viewingAgentTaskId is undefined)
 * - The task ID doesn't exist in tasks
 * - The task is not an in-process teammate task
 */
export function getViewedTeammateTask(
  appState: Pick<AppStateShape, 'viewingAgentTaskId' | 'tasks'>,
): InProcessTeammateTaskState | undefined {
  const { viewingAgentTaskId, tasks } = appState

  // Not viewing any teammate
  if (!viewingAgentTaskId) {
    return undefined
  }

  // Look up the task
  const task = tasks[viewingAgentTaskId]
  if (!task) {
    return undefined
  }

  // Verify it's an in-process teammate task
  if (!isInProcessTeammateTask(task)) {
    return undefined
  }

  return task
}

/**
 * Return type for getActiveAgentForInput selector.
 * Discriminated union for type-safe input routing.
 */
export type ActiveAgentForInput =
  | { type: 'leader' }
  | { type: 'viewed'; task: InProcessTeammateTaskState }
  | { type: 'named_agent'; task: LocalAgentTaskState }

/**
 * Determine where user input should be routed.
 * Returns:
 * - { type: 'leader' } when not viewing a teammate (input goes to leader)
 * - { type: 'viewed', task } when viewing an agent (input goes to that agent)
 *
 * Used by input routing logic to direct user messages to the correct agent.
 */
export function getActiveAgentForInput(
  appState: AppStateShape,
): ActiveAgentForInput {
  const viewedTask = getViewedTeammateTask(appState)
  if (viewedTask) {
    return { type: 'viewed', task: viewedTask }
  }

  const { viewingAgentTaskId, tasks } = appState
  if (viewingAgentTaskId) {
    const task = tasks[viewingAgentTaskId]
    if (task?.type === 'local_agent') {
      return { type: 'named_agent', task: task as LocalAgentTaskState }
    }
  }

  return { type: 'leader' }
}
