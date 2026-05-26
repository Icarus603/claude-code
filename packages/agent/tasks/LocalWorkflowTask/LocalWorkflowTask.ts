// LocalWorkflowTask — the AppState task record for a running/completed workflow
// orchestration. Port of ant 2.1.150 task lifecycle from module dt7 (3858.js),
// adapted to ccb's setAppState/AppState.tasks idiom (ant uses a taskRegistry
// object; ccb uses framework functions — same effect).

import type { SetAppState, Task, TaskStateBase } from '@claude-code/tool-registry/Task.js'
import { isTerminalTaskStatus } from '@claude-code/tool-registry/Task.js'
import {
  evictTerminalTask,
  registerTask,
  updateTaskState,
} from '../../task/framework.js'
import { enqueuePendingNotification } from '../../messageQueueManager.js'
import type {
  WorkflowPhaseMeta,
  WorkflowProgress,
} from '../../workflow/types.js'

// ant ct7 — keep at most this many workflow_log entries (older ones trimmed).
const MAX_LOG_ENTRIES = 500

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  script: string
  scriptPath?: string
  prompt: string
  args?: unknown
  summary?: string
  workflowName: string
  workflowRunId: string
  phases?: WorkflowPhaseMeta[]
  defaultModel?: string
  workflowProgress: WorkflowProgress[]
  progressVersion: number
  agentCount: number
  totalTokens: number
  totalToolCalls: number
  logs: string[]
  result?: unknown
  error?: string
  // Live-run handles (not persisted; cleared on terminal transition).
  abortController?: AbortController
  agentControllers?: Map<string, AbortController>
}

type RegisterArgs = {
  taskId: string
  script: string
  scriptPath?: string
  args?: unknown
  summary?: string
  workflowName: string
  phases?: WorkflowPhaseMeta[]
  defaultModel?: string
  workflowRunId: string
  toolUseId?: string
  abortController: AbortController
  agentControllers: Map<string, AbortController>
}

/** ant yI8 — register a new running workflow task. */
export function registerWorkflowTask(
  args: RegisterArgs,
  setAppState: SetAppState,
): LocalWorkflowTaskState {
  const base = createBase(args.taskId, args.summary ?? 'Workflow', args.toolUseId)
  const task: LocalWorkflowTaskState = {
    ...base,
    type: 'local_workflow',
    status: 'running',
    script: args.script,
    scriptPath: args.scriptPath,
    prompt: args.script,
    args: args.args,
    summary: args.summary,
    workflowName: args.workflowName,
    phases: args.phases,
    defaultModel: args.defaultModel,
    workflowRunId: args.workflowRunId,
    workflowProgress: [],
    progressVersion: 0,
    agentCount: 0,
    totalTokens: 0,
    totalToolCalls: 0,
    logs: [],
    abortController: args.abortController,
    agentControllers: args.agentControllers,
  }
  registerTask(task, setAppState)
  return task
}

function createBase(
  id: string,
  description: string,
  toolUseId?: string,
): TaskStateBase {
  return {
    id,
    type: 'local_workflow',
    status: 'running',
    description,
    toolUseId,
    startTime: Date.now(),
    outputFile: '',
    outputOffset: 0,
    notified: false,
  }
}

/**
 * ant hI8 — batch-merge progress events into the task. workflow_agent and
 * workflow_phase entries are keyed by (type,index) and replaced in place;
 * workflow_log entries are appended (and trimmed to MAX_LOG_ENTRIES).
 */
export function updateWorkflowProgressBatch(
  taskId: string,
  events: WorkflowProgress[],
  setAppState: SetAppState,
): void {
  if (events.length === 0) return
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    let progress = [...task.workflowProgress]
    const keyToIndex = new Map<string, number>()
    for (let i = 0; i < progress.length; i++) {
      const p = progress[i]!
      if (p.type === 'workflow_agent' || p.type === 'workflow_phase') {
        keyToIndex.set(`${p.type}:${p.index}`, i)
      }
    }
    let agentCount = task.agentCount
    let appendedLog = false
    for (const e of events) {
      if (e.type === 'workflow_agent' || e.type === 'workflow_phase') {
        const key = `${e.type}:${e.index}`
        const at = keyToIndex.get(key)
        if (at !== undefined) progress[at] = e
        else {
          keyToIndex.set(key, progress.length)
          progress.push(e)
        }
        if (e.type === 'workflow_agent' && e.state === 'start') {
          agentCount = Math.max(agentCount, e.index)
        }
      } else {
        progress.push(e)
        appendedLog = true
      }
    }
    // Trim excess log lines while keeping all agent/phase entries.
    if (appendedLog && progress.length > MAX_LOG_ENTRIES * 2) {
      let toDrop = progress.length - MAX_LOG_ENTRIES
      const kept: WorkflowProgress[] = []
      for (const p of progress) {
        if (toDrop > 0 && p.type === 'workflow_log') {
          toDrop--
          continue
        }
        kept.push(p)
      }
      progress = kept
    }
    let totalTokens = 0
    let totalToolCalls = 0
    for (const p of progress) {
      if (p.type === 'workflow_agent') {
        if (p.tokens) totalTokens += p.tokens
        if (p.toolCalls) totalToolCalls += p.toolCalls
      }
    }
    return {
      ...task,
      workflowProgress: progress,
      progressVersion: task.progressVersion + events.length,
      agentCount,
      totalTokens,
      totalToolCalls,
    }
  })
}

// ant UD6 — transition to a terminal/paused state, aborting the run.
function transition(
  taskId: string,
  setAppState: SetAppState,
  status: LocalWorkflowTaskState['status'],
  patch: Partial<LocalWorkflowTaskState>,
): LocalWorkflowTaskState | null {
  let captured: LocalWorkflowTaskState | null = null
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    captured = task
    task.abortController?.abort()
    return {
      ...task,
      ...patch,
      status,
      endTime: Date.now(),
      abortController: undefined,
      agentControllers: undefined,
    }
  })
  return captured
}

/** ant EI8 — mark a workflow completed. */
export function completeWorkflowTask(
  taskId: string,
  result: unknown,
  agentCount: number,
  logs: string[],
  setAppState: SetAppState,
): void {
  transition(taskId, setAppState, 'completed', { result, agentCount, logs })
}

/** ant FD6 — mark a workflow failed. */
export function failWorkflowTask(
  taskId: string,
  error: string,
  agentCount: number,
  logs: string[],
  setAppState: SetAppState,
): void {
  transition(taskId, setAppState, 'failed', { error, agentCount, logs })
}

/** ant FW_ — kill a running workflow. */
export function killWorkflowTask(taskId: string, setAppState: SetAppState): boolean {
  return transition(taskId, setAppState, 'killed', { notified: true }) !== null
}

/** ant SI8 — pause a running workflow (resume via scriptPath+resumeFromRunId). */
export function pauseWorkflowTask(taskId: string, setAppState: SetAppState): boolean {
  return transition(taskId, setAppState, 'paused', { notified: true }) !== null
}

// ant nt7 — abort a single in-flight agent (skip or retry).
function abortAgent(
  taskId: string,
  agentId: string,
  reason: 'user-skip' | 'user-retry',
  setAppState: SetAppState,
): boolean {
  let did = false
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    const ctrl = task.agentControllers?.get(agentId)
    if (ctrl && !ctrl.signal.aborted) {
      ctrl.abort(reason)
      did = true
    }
    return task
  })
  return did
}

/** ant II8 — skip one workflow agent. */
export function skipWorkflowAgent(
  taskId: string,
  agentId: string,
  setAppState: SetAppState,
): boolean {
  return abortAgent(taskId, agentId, 'user-skip', setAppState)
}

/** ant bI8 — retry one workflow agent. */
export function retryWorkflowAgent(
  taskId: string,
  agentId: string,
  setAppState: SetAppState,
): boolean {
  return abortAgent(taskId, agentId, 'user-retry', setAppState)
}

/** ant CI8 — build the resume hint for a paused/failed workflow. */
export function buildResumePrompt(task: LocalWorkflowTaskState): string {
  const argsStr = task.args !== undefined ? `, args: ${JSON.stringify(task.args)}` : ''
  return `Resume the paused workflow by calling: Workflow({scriptPath: '${task.scriptPath}', resumeFromRunId: '${task.workflowRunId}'${argsStr}}) — completed agents return cached results.`
}

/** ant gD6 — enqueue the task-completion notification. */
export function enqueueWorkflowNotification(args: {
  taskId: string
  summary?: string
  status: 'completed' | 'failed' | 'killed'
  result?: unknown
  failures?: string[]
  error?: string
  agentCount: number
  totalTokens: number
  totalToolCalls: number
  durationMs: number
  scriptPath?: string
  workflowRunId?: string
  args?: unknown
  transcriptDir?: string
  setAppState: SetAppState
}): void {
  let shouldNotify = false
  updateTaskState<LocalWorkflowTaskState>(args.taskId, args.setAppState, task => {
    if (task.notified) return task
    shouldNotify = true
    return { ...task, notified: true }
  })
  if (!shouldNotify) return

  const name = args.summary ?? 'Workflow'
  const headline =
    args.status === 'completed'
      ? `Workflow "${name}" completed`
      : args.status === 'failed'
        ? `Workflow "${name}" failed: ${args.error || 'Unknown error'}`
        : `Workflow "${name}" was stopped`

  let recovery = ''
  if (args.status === 'failed' || args.status === 'killed') {
    const lines: string[] = []
    if (args.scriptPath && args.workflowRunId) {
      const argsStr =
        args.args !== undefined ? `, args: ${JSON.stringify(args.args)}` : ''
      lines.push(
        `To resume after editing the script, call: Workflow({scriptPath: '${args.scriptPath}', resumeFromRunId: '${args.workflowRunId}'${argsStr}})`,
      )
    }
    if (args.transcriptDir) lines.push(`Agent transcripts: ${args.transcriptDir}`)
    if (lines.length > 0) recovery = `\n<recovery>${lines.join('\n')}</recovery>`
  }

  let resultBlock = ''
  if (args.status === 'completed' && args.result !== undefined) {
    const text = JSON.stringify(args.result)
    resultBlock =
      text.length > 8000
        ? `\n<result>${text.slice(0, 8000)}\n... (truncated ${text.length - 8000} chars)</result>`
        : `\n<result>${text}</result>`
  }
  const failuresBlock = args.failures?.length
    ? `\n<failures>${args.failures.join('\n')}</failures>`
    : ''
  const usage = `\n<usage><agent_count>${args.agentCount}</agent_count><total_tokens>${args.totalTokens}</total_tokens><tool_uses>${args.totalToolCalls}</tool_uses><duration_ms>${args.durationMs}</duration_ms></usage>`

  const message = `<task-notification>
<task-id>${args.taskId}</task-id>
<status>${args.status}</status>
<summary>${headline}</summary>${recovery}${resultBlock}${failuresBlock}${usage}
</task-notification>`

  enqueuePendingNotification({ value: message, mode: 'task-notification', priority: 'next' })
}

/** Evict a terminal workflow task after notification. */
export function evictWorkflowTask(taskId: string, setAppState: SetAppState): void {
  evictTerminalTask(taskId, setAppState)
}

export function isWorkflowTerminal(
  status: LocalWorkflowTaskState['status'],
): boolean {
  return isTerminalTaskStatus(status)
}

// ant vw3 — the Task dispatch record (kill handler).
export const LocalWorkflowTask: Task = {
  name: 'LocalWorkflowTask',
  type: 'local_workflow',
  async kill(taskId: string, setAppState: SetAppState): Promise<void> {
    killWorkflowTask(taskId, setAppState)
  },
}
