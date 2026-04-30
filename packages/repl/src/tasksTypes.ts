// Union of all concrete task state types
// Use this for components that need to work with any task type

import type { DreamTaskState } from '@claude-code/agent/tasks/DreamTask/DreamTask.js'
import type { InProcessTeammateTaskState } from '@claude-code/swarm'
import type { LocalAgentTaskState } from '@claude-code/agent/localAgentTask.js'
import type { LocalShellTaskState } from './localShellTaskGuards.js'
import type { LocalWorkflowTaskState } from '@claude-code/agent/tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type { MonitorMcpTaskState } from '@claude-code/agent/tasks/MonitorMcpTask/MonitorMcpTask.js'
import type { RemoteAgentTaskState } from '@claude-code/tool-registry/tasks/RemoteAgentTask.js'

export type TaskState =
  | LocalShellTaskState
  | LocalAgentTaskState
  | RemoteAgentTaskState
  | InProcessTeammateTaskState
  | LocalWorkflowTaskState
  | MonitorMcpTaskState
  | DreamTaskState

// Task types that can appear in the background tasks indicator
export type BackgroundTaskState =
  | LocalShellTaskState
  | LocalAgentTaskState
  | RemoteAgentTaskState
  | InProcessTeammateTaskState
  | LocalWorkflowTaskState
  | MonitorMcpTaskState
  | DreamTaskState

/**
 * Check if a task should be shown in the background tasks indicator.
 * A task is considered a background task if:
 * 1. It is running or pending
 * 2. It has been explicitly backgrounded (not a foreground task)
 *
 * Input is loosened to a structural shape so callers from
 * @claude-code/agent/task/framework (which uses a narrow base
 * TaskState `{id, type, status, [key]: unknown}` to avoid a circular
 * import of the full union) can pass directly without an assertion.
 * The narrowing intent is preserved via the type predicate — at the
 * call site the variable is still narrowed to BackgroundTaskState
 * inside the truthy branch.
 */
export function isBackgroundTask(
  task: { status: string; type?: string; isBackgrounded?: boolean; [k: string]: unknown },
): task is BackgroundTaskState {
  if (task.status !== 'running' && task.status !== 'pending') {
    return false
  }
  // Foreground tasks (isBackgrounded === false) are not yet "background tasks"
  if ('isBackgrounded' in task && task.isBackgrounded === false) {
    return false
  }
  return true
}
