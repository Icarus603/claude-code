/**
 * Idle-state polling for in-process teammates. Extracted from
 * inProcessRunner.ts to keep the runner's main loop focused on the
 * agent lifecycle (run → idle → run).
 *
 * waitForNextPromptOrShutdown is the single decision point that
 * resumes a teammate. It checks (in priority order):
 *   1. In-memory pending user messages (transcript-view manual sends)
 *   2. Unprocessed shutdown_requests (auth ledger: processedRequestIds)
 *   3. Team-lead messages (priority over peer DMs)
 *   4. Other unread mailbox messages
 *   5. Unclaimed tasks from the team task list
 *
 * The "exactly-once shutdown delivery" contract lives here — see the
 * comment block on the shutdown scan loop for why we ignore the
 * `read` flag on the mailbox file and use processedRequestIds as the
 * source of truth.
 */
import type { AppState as AppStateBinding } from '../adapters/appRuntime.js'
import { count, logForDebugging, sleep } from '../adapters/appRuntime.js'

/**
 * Local re-shape of the swarm-runtime AppState binding so we can
 * read `appState.tasks[taskId]` without TS2339. Same rationale as
 * the Task narrowing above — the runtime binding is `unknown` by
 * design.
 */
type AppState = AppStateBinding & {
  tasks: Record<string, unknown>
}
import {
  claimTask,
  listTasks,
  type Task as TaskBinding,
  updateTask,
} from '../adapters/appRuntime.js'

/**
 * Local re-shape of the swarm-runtime Task binding so this file can
 * read `task.id`, `task.status`, etc. without TS2339 every time.
 * The runtime binding is `unknown` by design (it bridges to the host
 * package's full Task type without a circular import); narrowing
 * here keeps the noise local.
 */
type Task = TaskBinding & {
  id: string
  status: string
  owner?: string
  blockedBy: string[]
  subject?: string
  description?: string
}
import { TEAM_LEAD_NAME } from '../core/constants.js'
import {
  isShutdownRequest,
  markMessageAsReadByIndex,
  readMailbox,
} from '../mailbox/index.js'
import type { InProcessTeammateTaskState, TeammateIdentity } from '../tasks/types.js'

type SetAppStateFn = (updater: (prev: AppState) => AppState) => void

/**
 * Result of waiting for messages.
 */
type WaitResult =
  | {
      type: 'shutdown_request'
      request: ReturnType<typeof isShutdownRequest>
      originalMessage: string
    }
  | {
      type: 'new_message'
      message: string
      from: string
      color?: string
      summary?: string
    }
  | {
      type: 'aborted'
    }

/**
 * Find an available task from the team's task list. A task is
 * available if it's pending, has no owner, and is not blocked.
 */
function findAvailableTask(tasks: Task[]): Task | undefined {
  const unresolvedTaskIds = new Set(
    tasks.filter(t => t.status !== 'completed').map(t => t.id),
  )

  return tasks.find(task => {
    if (task.status !== 'pending') return false
    if (task.owner) return false
    return task.blockedBy.every(id => !unresolvedTaskIds.has(id))
  })
}

/**
 * Format a task as a prompt for the teammate to work on.
 */
function formatTaskAsPrompt(task: Task): string {
  let prompt = `Complete all open tasks. Start with task #${task.id}: \n\n ${task.subject}`

  if (task.description) {
    prompt += `\n\n${task.description}`
  }

  return prompt
}

/**
 * Try to claim an available task from the team's task list.
 * Returns the formatted prompt if a task was claimed, or undefined if
 * none available.
 *
 * Exported for use by runInProcessTeammate's startup path (a fresh
 * teammate claims its first task before entering the agent loop).
 */
export async function tryClaimNextTask(
  taskListId: string,
  agentName: string,
): Promise<string | undefined> {
  try {
    const tasks = await listTasks(taskListId)
    const availableTask = findAvailableTask(tasks)

    if (!availableTask) {
      return undefined
    }

    const result = await claimTask(taskListId, availableTask.id, agentName)

    if (!result.success) {
      logForDebugging(
        `[inProcessRunner] Failed to claim task #${availableTask.id}: ${result.reason}`,
      )
      return undefined
    }

    // Also set status to in_progress so the UI reflects it immediately
    await updateTask(taskListId, availableTask.id, { status: 'in_progress' })

    logForDebugging(
      `[inProcessRunner] Claimed task #${availableTask.id}: ${availableTask.subject}`,
    )

    return formatTaskAsPrompt(availableTask)
  } catch (err) {
    logForDebugging(`[inProcessRunner] Error checking task list: ${err}`)
    return undefined
  }
}

/**
 * Waits for new prompts or shutdown request.
 * Polls the teammate's mailbox every 500ms, checking for:
 * - Shutdown request from leader (returned to caller for model decision)
 * - New messages/prompts from leader
 * - Abort signal
 *
 * This keeps the teammate alive in 'idle' state instead of terminating.
 * Does NOT auto-approve shutdown - the model should make that decision.
 *
 * `processedRequestIds` is the runner's in-memory ledger of shutdown
 * requestIds it has already handed to the model. Combined with the
 * mailbox-level requestId dedup in writeToMailbox, this guarantees that
 * a single shutdown_request is delivered to the model exactly once even
 * when (a) the caller retries the request multiple times, or (b) the
 * mailbox `read` flag is mis-stamped by a racing reader. The set is
 * scoped to a single teammate process — once shutdown is approved the
 * process exits and the set goes with it.
 */
export async function waitForNextPromptOrShutdown(
  identity: TeammateIdentity,
  abortController: AbortController,
  taskId: string,
  getAppState: () => AppState,
  setAppState: SetAppStateFn,
  taskListId: string,
  processedRequestIds: Set<string>,
): Promise<WaitResult> {
  const POLL_INTERVAL_MS = 500

  logForDebugging(
    `[inProcessRunner] ${identity.agentName} starting poll loop (abort=${abortController.signal.aborted})`,
  )

  let pollCount = 0
  while (!abortController.signal.aborted) {
    // Check for in-memory pending messages on every iteration (from transcript viewing)
    const appState = getAppState()
    const task = appState.tasks[taskId] as
      | InProcessTeammateTaskState
      | undefined
    if (
      task &&
      task.type === 'in_process_teammate' &&
      task.pendingUserMessages.length > 0
    ) {
      const message = task.pendingUserMessages[0]! // Safe: checked length > 0
      // Pop the message from the queue
      setAppState(prev => {
        const prevTask = prev.tasks[taskId] as
          | InProcessTeammateTaskState
          | undefined
        if (!prevTask || prevTask.type !== 'in_process_teammate') {
          return prev
        }
        return {
          ...prev,
          tasks: {
            ...prev.tasks,
            [taskId]: {
              ...prevTask,
              pendingUserMessages: prevTask.pendingUserMessages.slice(1),
            },
          },
        }
      })
      logForDebugging(
        `[inProcessRunner] ${identity.agentName} found pending user message (poll #${pollCount})`,
      )
      return {
        type: 'new_message',
        message,
        from: 'user',
      }
    }

    // Wait before next poll (skip on first iteration to check immediately)
    if (pollCount > 0) {
      await sleep(POLL_INTERVAL_MS)
    }
    pollCount++

    // Check for abort
    if (abortController.signal.aborted) {
      logForDebugging(
        `[inProcessRunner] ${identity.agentName} aborted while waiting (poll #${pollCount})`,
      )
      return { type: 'aborted' }
    }

    // Check for messages in mailbox
    logForDebugging(
      `[inProcessRunner] ${identity.agentName} poll #${pollCount}: checking mailbox`,
    )
    try {
      // Read all messages and scan unread for shutdown requests first.
      // Shutdown requests are prioritized over regular messages to prevent
      // starvation when peer-to-peer messages flood the queue.
      const allMessages = await readMailbox(
        identity.agentName,
        identity.teamName,
      )

      // Scan all messages for shutdown requests (highest priority).
      // We do NOT filter on `m.read` — the read flag is a UI/file-side
      // detail that can be racily-flipped by other readers, and was the
      // root of the "fixer-agent stuck after 4 shutdown_requests" bug
      // (each request marked read by attachment generator, runner never
      // saw any). The authoritative "did this runner already process
      // this requestId?" signal is `processedRequestIds` (in-memory,
      // owned by this runner). Combined with the mailbox-level
      // (type,requestId) dedup in writeToMailbox, a shutdown request is
      // delivered to the model exactly once per runner instance.
      let shutdownIndex = -1
      let shutdownParsed: ReturnType<typeof isShutdownRequest> = null
      for (let i = 0; i < allMessages.length; i++) {
        const m = allMessages[i]
        if (!m) continue
        const parsed = isShutdownRequest(m.text)
        if (parsed && !processedRequestIds.has(parsed.requestId)) {
          shutdownIndex = i
          shutdownParsed = parsed
          break
        }
      }

      if (shutdownIndex !== -1) {
        const msg = allMessages[shutdownIndex]!
        const skippedUnread = count(
          allMessages.slice(0, shutdownIndex),
          m => !m.read,
        )
        logForDebugging(
          `[inProcessRunner] ${identity.agentName} received shutdown request from ${shutdownParsed?.from} (prioritized over ${skippedUnread} unread messages)`,
        )
        // Record before delivery so a crash mid-delivery doesn't cause
        // re-delivery on the next poll (we'd rather drop a request than
        // silently approve shutdown twice).
        if (shutdownParsed?.requestId) {
          processedRequestIds.add(shutdownParsed.requestId)
        }
        await markMessageAsReadByIndex(
          identity.agentName,
          identity.teamName,
          shutdownIndex,
        )
        return {
          type: 'shutdown_request',
          request: shutdownParsed,
          originalMessage: msg.text,
        }
      }

      // No shutdown request found. Prioritize team-lead messages over peer
      // messages — the leader represents user intent and coordination, so
      // their messages should not be starved behind peer-to-peer chatter.
      // Fall back to FIFO for peer messages.
      let selectedIndex = -1

      // Check for unread team-lead messages first
      for (let i = 0; i < allMessages.length; i++) {
        const m = allMessages[i]
        if (m && !m.read && m.from === TEAM_LEAD_NAME) {
          selectedIndex = i
          break
        }
      }

      // Fall back to first unread message (any sender)
      if (selectedIndex === -1) {
        selectedIndex = allMessages.findIndex(m => !m.read)
      }

      if (selectedIndex !== -1) {
        const msg = allMessages[selectedIndex]
        if (msg) {
          logForDebugging(
            `[inProcessRunner] ${identity.agentName} received new message from ${msg.from} (index ${selectedIndex})`,
          )
          await markMessageAsReadByIndex(
            identity.agentName,
            identity.teamName,
            selectedIndex,
          )
          return {
            type: 'new_message',
            message: msg.text,
            from: msg.from,
            color: msg.color,
            summary: msg.summary,
          }
        }
      }
    } catch (err) {
      logForDebugging(
        `[inProcessRunner] ${identity.agentName} poll error: ${err}`,
      )
      // Continue polling even if one read fails
    }

    // Check the team's task list for unclaimed tasks
    const taskPrompt = await tryClaimNextTask(taskListId, identity.agentName)
    if (taskPrompt) {
      return {
        type: 'new_message',
        message: taskPrompt,
        from: 'task-list',
      }
    }
  }

  logForDebugging(
    `[inProcessRunner] ${identity.agentName} exiting poll loop (abort=${abortController.signal.aborted}, polls=${pollCount})`,
  )
  return { type: 'aborted' }
}
