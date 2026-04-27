import { feature } from 'bun:bundle'
import type { Task, TaskType } from '@claude-code/tool-registry/Task.js'
import { DreamTask } from './DreamTask/DreamTask.js'
import { LocalAgentTask } from '../localAgentTask.js'
import { LocalShellTask } from './LocalShellTask.js'
import { RemoteAgentTask } from '@claude-code/tool-registry/tasks/RemoteAgentTask.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const LocalWorkflowTask: Task | null = feature('WORKFLOW_SCRIPTS')
  ? require('./LocalWorkflowTask/LocalWorkflowTask.js').LocalWorkflowTask
  : null
const MonitorMcpTask: Task | null = feature('MONITOR_TOOL')
  ? require('./MonitorMcpTask/MonitorMcpTask.js').MonitorMcpTask
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Get all tasks.
 * Mirrors the pattern from tools.ts
 * Note: Returns array inline to avoid circular dependency issues with top-level const
 */
export function getAllTasks(): Task[] {
  const tasks: Task[] = [
    LocalShellTask,
    LocalAgentTask,
    RemoteAgentTask,
    DreamTask,
  ]
  if (LocalWorkflowTask) tasks.push(LocalWorkflowTask)
  if (MonitorMcpTask) tasks.push(MonitorMcpTask)
  return tasks
}

/**
 * Get a task by its type.
 */
export function getTaskByType(type: TaskType): Task | undefined {
  return getAllTasks().find(t => t.type === type)
}
