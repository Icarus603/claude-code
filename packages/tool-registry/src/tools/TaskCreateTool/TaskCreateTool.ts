import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  executeTaskCreatedHooks,
  getTaskCreatedHookMessage,
} from '@claude-code/agent/hooks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  blockTask,
  createTask,
  deleteTask,
  getTaskListId,
  isTodoV2Enabled,
} from '@claude-code/agent/tasks.js'
import { getAgentName, getTeamName } from '@claude-code/swarm/teammateState.js'
import { TASK_CREATE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    subject: z.string().describe('A brief title for the task'),
    description: z.string().describe('What needs to be done'),
    activeForm: z
      .string()
      .optional()
      .describe(
        'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
      ),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Arbitrary metadata to attach to the task'),
    blockedBy: z
      .array(z.string())
      .optional()
      .describe(
        'Task IDs that must complete before this task can start. Lets you build a dependency graph in one step (e.g. a "verifier" task with blockedBy: [1,2,3] auto-becomes claimable when 1+2+3 finish). Cycles are rejected with TaskCycleError.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    task: z.object({
      id: z.string(),
      subject: z.string(),
    }),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const TaskCreateTool = buildTool({
  name: TASK_CREATE_TOOL_NAME,
  searchHint: 'create a task in the task list',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'TaskCreate'
  },
  shouldDefer: true,
  isEnabled() {
    return isTodoV2Enabled()
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.subject
  },
  renderToolUseMessage() {
    return null
  },
  async call(
    { subject, description, activeForm, metadata, blockedBy },
    context,
  ) {
    const taskListId = getTaskListId()
    const taskId = await createTask(taskListId, {
      subject,
      description,
      activeForm,
      status: 'pending',
      owner: undefined,
      blocks: [],
      blockedBy: [],
      metadata,
    })

    // Wire up blockedBy edges in the same call. blockTask is the
    // single source of truth for cycle detection + bipartite invariant
    // — using the same path as TaskUpdate keeps semantics in one place.
    // On cycle (or any other blockTask failure) we roll the new task
    // back so the caller doesn't see a half-attached node.
    if (blockedBy && blockedBy.length > 0) {
      try {
        for (const blockerId of blockedBy) {
          await blockTask(taskListId, blockerId, taskId)
        }
      } catch (err) {
        await deleteTask(taskListId, taskId)
        if (err instanceof Error && err.name === 'TaskCycleError') {
          throw err
        }
        throw err
      }
    }

    const blockingErrors: string[] = []
    const generator = executeTaskCreatedHooks(
      taskId,
      subject,
      description,
      getAgentName(),
      getTeamName(),
      undefined,
      context?.abortController?.signal,
      undefined,
      context,
    )
    for await (const result of generator) {
      if (result.blockingError) {
        blockingErrors.push(getTaskCreatedHookMessage(result.blockingError))
      }
    }

    if (blockingErrors.length > 0) {
      await deleteTask(taskListId, taskId)
      throw new Error(blockingErrors.join('\n'))
    }

    // Auto-expand task list when creating tasks
    context.setAppState(prev => {
      if (prev.expandedView === 'tasks') return prev
      return { ...prev, expandedView: 'tasks' as const }
    })

    return {
      data: {
        task: {
          id: taskId,
          subject,
        },
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { task } = content as Output
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Task #${task.id} created successfully: ${task.subject}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
