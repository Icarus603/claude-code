import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isAgentSwarmsEnabled } from '@claude-code/agent/agentSwarmsEnabled.js'
import {
  executeTaskCompletedHooks,
  getTaskCompletedHookMessage,
} from '@claude-code/agent/hooks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  blockTask,
  cascadeUnblockOnCompletion,
  deleteTask,
  getTask,
  getTaskListId,
  isTodoV2Enabled,
  listTasks,
  type TaskStatus,
  TaskStatusSchema,
  updateTask,
} from '@claude-code/agent/tasks.js'
import {
  getAgentId,
  getAgentName,
  getTeammateColor,
  getTeamName,
} from '@claude-code/swarm/teammateState.js'
import { readTeamFileAsync, writeToMailbox } from '@claude-code/swarm'
import { VERIFICATION_AGENT_TYPE } from '../AgentTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() => {
  // Extended status schema that includes 'deleted' as a special action
  const TaskUpdateStatusSchema = TaskStatusSchema().or(z.literal('deleted'))

  return z.strictObject({
    taskId: z.string().describe('The ID of the task to update'),
    subject: z.string().optional().describe('New subject for the task'),
    description: z.string().optional().describe('New description for the task'),
    activeForm: z
      .string()
      .optional()
      .describe(
        'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
      ),
    status: TaskUpdateStatusSchema.optional().describe(
      'New status for the task',
    ),
    addBlockedBy: z
      .array(z.string())
      .optional()
      .describe(
        'Task IDs that block this task — i.e. each listed task must complete before this one can start. To express the inverse ("this task blocks B"), call TaskUpdate on B with addBlockedBy: [thisTaskId]; one direction is enough because the dependency graph is bipartite.',
      ),
    owner: z.string().optional().describe('New owner for the task'),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Metadata keys to merge into the task. Set a key to null to delete it.',
      ),
  })
})
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    taskId: z.string(),
    updatedFields: z.array(z.string()),
    error: z.string().optional(),
    statusChange: z
      .object({
        from: z.string(),
        to: z.string(),
      })
      .optional(),
    verificationNudgeNeeded: z.boolean().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const TaskUpdateTool = buildTool({
  name: TASK_UPDATE_TOOL_NAME,
  searchHint: 'update a task',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'TaskUpdate'
  },
  shouldDefer: true,
  isEnabled() {
    return isTodoV2Enabled()
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    const parts = [input.taskId]
    if (input.status) parts.push(input.status)
    if (input.subject) parts.push(input.subject)
    return parts.join(' ')
  },
  renderToolUseMessage() {
    return null
  },
  async call(
    {
      taskId,
      subject,
      description,
      activeForm,
      status,
      owner,
      addBlockedBy,
      metadata,
    },
    context,
  ) {
    const taskListId = getTaskListId()

    // Auto-expand task list when updating tasks
    context.setAppState(prev => {
      if (prev.expandedView === 'tasks') return prev
      return { ...prev, expandedView: 'tasks' as const }
    })

    // Check if task exists
    const existingTask = await getTask(taskListId, taskId)
    if (!existingTask) {
      return {
        data: {
          success: false,
          taskId,
          updatedFields: [],
          error: 'Task not found',
        },
      }
    }

    const updatedFields: string[] = []

    // Update basic fields if provided and different from current value
    const updates: {
      subject?: string
      description?: string
      activeForm?: string
      status?: TaskStatus
      owner?: string
      metadata?: Record<string, unknown>
    } = {}
    if (subject !== undefined && subject !== existingTask.subject) {
      updates.subject = subject
      updatedFields.push('subject')
    }
    if (description !== undefined && description !== existingTask.description) {
      updates.description = description
      updatedFields.push('description')
    }
    if (activeForm !== undefined && activeForm !== existingTask.activeForm) {
      updates.activeForm = activeForm
      updatedFields.push('activeForm')
    }
    if (owner !== undefined && owner !== existingTask.owner) {
      updates.owner = owner
      updatedFields.push('owner')
    }
    // Auto-set owner when a teammate marks a task as in_progress without
    // explicitly providing an owner. This ensures the task list can match
    // todo items to teammates for showing activity status.
    if (
      isAgentSwarmsEnabled() &&
      status === 'in_progress' &&
      owner === undefined &&
      !existingTask.owner
    ) {
      const agentName = getAgentName()
      if (agentName) {
        updates.owner = agentName
        updatedFields.push('owner')
      }
    }
    if (metadata !== undefined) {
      const merged = { ...(existingTask.metadata ?? {}) }
      for (const [key, value] of Object.entries(metadata)) {
        if (value === null) {
          delete merged[key]
        } else {
          merged[key] = value
        }
      }
      updates.metadata = merged
      updatedFields.push('metadata')
    }
    if (status !== undefined) {
      // Handle deletion - delete the task file and return early
      if (status === 'deleted') {
        const deleted = await deleteTask(taskListId, taskId)
        return {
          data: {
            success: deleted,
            taskId,
            updatedFields: deleted ? ['deleted'] : [],
            error: deleted ? undefined : 'Failed to delete task',
            statusChange: deleted
              ? { from: existingTask.status, to: 'deleted' }
              : undefined,
          },
        }
      }

      // For regular status updates, validate and apply if different
      if (status !== existingTask.status) {
        // Run TaskCompleted hooks when marking a task as completed
        if (status === 'completed') {
          const blockingErrors: string[] = []

          const generator = executeTaskCompletedHooks(
            taskId,
            existingTask.subject,
            existingTask.description,
            getAgentName(),
            getTeamName(),
            undefined,
            context?.abortController?.signal,
            undefined,
            context,
          )

          for await (const result of generator) {
            if (result.blockingError) {
              blockingErrors.push(
                getTaskCompletedHookMessage(result.blockingError),
              )
            }
          }

          if (blockingErrors.length > 0) {
            return {
              data: {
                success: false,
                taskId,
                updatedFields: [],
                error: blockingErrors.join('\n'),
              },
            }
          }
        }

        updates.status = status
        updatedFields.push('status')
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateTask(taskListId, taskId, updates)
    }

    // Notify new owner via mailbox when ownership changes
    if (updates.owner && isAgentSwarmsEnabled()) {
      const senderName = getAgentName() || 'team-lead'
      const senderColor = getTeammateColor()
      const assignmentMessage = JSON.stringify({
        type: 'task_assignment',
        taskId,
        subject: existingTask.subject,
        description: existingTask.description,
        assignedBy: senderName,
        timestamp: new Date().toISOString(),
      })
      await writeToMailbox(
        updates.owner,
        {
          from: senderName,
          text: assignmentMessage,
          timestamp: new Date().toISOString(),
          color: senderColor,
        },
        taskListId,
      )

      // Symmetry: when an explicit owner change replaces a previous
      // owner, tell the OLD owner they've been unassigned. Without this
      // they keep believing they're on the hook and may continue working
      // or argue against re-claiming when they shouldn't. Skipped if the
      // task had no owner before (nothing to notify).
      if (existingTask.owner && existingTask.owner !== updates.owner) {
        const unassignmentMessage = JSON.stringify({
          type: 'task_unassignment',
          taskId,
          subject: existingTask.subject,
          unassignedBy: senderName,
          newOwner: updates.owner,
          timestamp: new Date().toISOString(),
        })
        await writeToMailbox(
          existingTask.owner,
          {
            from: senderName,
            text: unassignmentMessage,
            timestamp: new Date().toISOString(),
            color: senderColor,
          },
          taskListId,
        )
      }
    }

    // Add blockedBy if provided and not already present. blockTask
    // throws TaskCycleError on cycles — surface that as a tool error
    // instead of letting it crash the turn (the caller can adjust).
    if (addBlockedBy && addBlockedBy.length > 0) {
      const newBlockedBy = addBlockedBy.filter(
        id => !existingTask.blockedBy.includes(id),
      )
      try {
        for (const blockerId of newBlockedBy) {
          await blockTask(taskListId, blockerId, taskId)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'TaskCycleError') {
          return {
            data: {
              success: false,
              taskId,
              updatedFields,
              error: err.message,
            },
          }
        }
        throw err
      }
      if (newBlockedBy.length > 0) {
        updatedFields.push('blockedBy')
      }
    }

    // Cascade-unblock: when a task transitions to completed, scrub its
    // ID from every other task's blockedBy. Without this, completed
    // task IDs accumulate forever (read-side filters in claimTask paper
    // over the symptom but TaskGet output keeps showing ghost deps).
    // Wake-up: idle teammates that just became fully unblocked get a
    // task_unblocked mailbox message so they re-check the task list
    // without waiting for the next 500ms poll.
    if (updates.status === 'completed' && isAgentSwarmsEnabled()) {
      const senderName = getAgentName() || 'team-lead'
      const senderColor = getTeammateColor()
      const { newlyUnblockedIds } = await cascadeUnblockOnCompletion(
        taskListId,
        taskId,
      )
      if (newlyUnblockedIds.length > 0) {
        const allTasks = await listTasks(taskListId)
        // Candidate set: every owner of an open task. We then narrow
        // to "actually-active teammates" by intersecting with the
        // team file's member roster — a teammate that has since
        // shut down is removed from team config (see
        // removeTeammateFromTeamFile in core/teamHelpers.ts), so the
        // intersection is the live set. Without this, we'd send
        // task_unblocked into dead inboxes that no one drains.
        const candidateOwners = new Set<string>()
        for (const t of allTasks) {
          if (t.owner && t.status !== 'completed') {
            candidateOwners.add(t.owner)
          }
        }
        let idleOwners: Set<string> = candidateOwners
        const currentTeamName = getTeamName()
        if (currentTeamName && candidateOwners.size > 0) {
          const teamFile = await readTeamFileAsync(currentTeamName)
          if (teamFile) {
            const liveMemberNames = new Set(teamFile.members.map(m => m.name))
            idleOwners = new Set(
              Array.from(candidateOwners).filter(o => liveMemberNames.has(o)),
            )
          }
        }
        if (idleOwners.size > 0) {
          const unblockMessage = JSON.stringify({
            type: 'task_unblocked',
            unblockedTaskIds: newlyUnblockedIds,
            byCompletingTaskId: taskId,
            from: senderName,
            timestamp: new Date().toISOString(),
          })
          await Promise.all(
            Array.from(idleOwners).map(owner =>
              writeToMailbox(
                owner,
                {
                  from: senderName,
                  text: unblockMessage,
                  timestamp: new Date().toISOString(),
                  color: senderColor,
                },
                taskListId,
              ),
            ),
          )
        }
      }
    }

    // Structural verification nudge: if the main-thread agent just closed
    // out a 3+ task list and none of those tasks was a verification step,
    // append a reminder to the tool result. Fires at the loop-exit moment
    // where skips happen ("when the last task closed, the loop exited").
    // Mirrors the TodoWriteTool nudge for V1 sessions; this covers V2
    // (interactive CLI). TaskUpdateToolOutput is @internal so this field
    // does not touch the public SDK surface.
    let verificationNudgeNeeded = false
    if (
      feature('VERIFICATION_AGENT') &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_hive_evidence', false) &&
      !context.agentId &&
      updates.status === 'completed'
    ) {
      const allTasks = await listTasks(taskListId)
      const allDone = allTasks.every(t => t.status === 'completed')
      if (
        allDone &&
        allTasks.length >= 3 &&
        !allTasks.some(t => /verif/i.test(t.subject))
      ) {
        verificationNudgeNeeded = true
      }
    }

    return {
      data: {
        success: true,
        taskId,
        updatedFields,
        statusChange:
          updates.status !== undefined
            ? { from: existingTask.status, to: updates.status }
            : undefined,
        verificationNudgeNeeded,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const {
      success,
      taskId,
      updatedFields,
      error,
      statusChange,
      verificationNudgeNeeded,
    } = content as Output
    if (!success) {
      // Return as non-error so it doesn't trigger sibling tool cancellation
      // in StreamingToolExecutor. "Task not found" is a benign condition
      // (e.g., task list already cleaned up) that the model can handle.
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: error || `Task #${taskId} not found`,
      }
    }

    let resultContent = `Updated task #${taskId} ${updatedFields.join(', ')}`

    // Add reminder for teammates when they complete a task (supports in-process teammates)
    if (
      statusChange?.to === 'completed' &&
      getAgentId() &&
      isAgentSwarmsEnabled()
    ) {
      resultContent +=
        '\n\nTask completed. Call TaskList now to find your next available task or see if your work unblocked others.'
    }

    if (verificationNudgeNeeded) {
      resultContent += `\n\nNOTE: You just closed out 3+ tasks and none of them was a verification step. Before writing your final summary, spawn the verification agent (subagent_type="${VERIFICATION_AGENT_TYPE}"). You cannot self-assign PARTIAL by listing caveats in your summary — only the verifier issues a verdict.`
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: resultContent,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
