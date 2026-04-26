// Auto-generated stub — replace with real implementation
import type { TaskStateBase, SetAppState } from '@claude-code/tool-registry/Task.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  summary?: string
  description: string
}
export const killWorkflowTask: (id: string, setAppState: SetAppState) => void = (() => {});
export const skipWorkflowAgent: (id: string, agentId: string, setAppState: SetAppState) => void = (() => {});
export const retryWorkflowAgent: (id: string, agentId: string, setAppState: SetAppState) => void = (() => {});
