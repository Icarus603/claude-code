import { feature } from 'bun:bundle'
import {
  executeAutoDream,
  executeExtractMemories,
  isExtractModeActive,
} from '@claude-code/memory'
import { getAgentHostBindings } from '../host.js'
import type {
  AgentAssistantMessage,
  AgentHookProgress,
  AgentMessage,
  AgentQuerySource,
  AgentREPLHookContext,
  AgentRequestStartEvent,
  AgentStopHookInfo,
  AgentStreamEvent,
  AgentSystemPrompt,
  AgentToolUseContext,
  AgentTombstoneMessage,
  AgentToolUseSummaryMessage,
  AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../internalTypes.js'
import { errorMessage, isBareMode, isEnvDefinedFalsy } from '../internalUtils.js'


type StopHookResult = {
  blockingErrors: AgentMessage[]
  preventContinuation: boolean
}

export async function* handleStopHooks(
  messagesForQuery: AgentMessage[],
  assistantMessages: AgentAssistantMessage[],
  systemPrompt: AgentSystemPrompt,
  userContext: { [k: string]: string },
  systemContext: { [k: string]: string },
  toolUseContext: AgentToolUseContext,
  querySource: AgentQuerySource,
  stopHookActive?: boolean,
): AsyncGenerator<
  | AgentStreamEvent
  | AgentRequestStartEvent
  | AgentMessage
  | AgentTombstoneMessage
  | AgentToolUseSummaryMessage,
  StopHookResult
> {
  const hookStartTime = Date.now()

  const stopHookContext: AgentREPLHookContext = {
    messages: [...messagesForQuery, ...assistantMessages],
    systemPrompt,
    userContext,
    systemContext,
    toolUseContext,
    querySource,
  }
  // Only save params for main session queries — subagents must not overwrite.
  // Outside the prompt-suggestion gate: the REPL /btw command and the
  // side_question SDK control_request both read this snapshot, and neither
  // depends on prompt suggestions being enabled.
  if (querySource === 'repl_main_thread' || querySource === 'sdk') {
    const params = getAgentHostBindings().createCacheSafeParams?.(stopHookContext)
    if (params !== undefined) getAgentHostBindings().saveCacheSafeParams?.(params)
  }

  // Template job classification: when running as a dispatched job, classify
  // state after each turn. Gate on repl_main_thread so background forks
  // (extract-memories, auto-dream) don't pollute the timeline with their own
  // assistant messages. Await the classifier so state.json is written before
  // the turn returns — otherwise `claude list` shows stale state for the gap.
  // Env key hardcoded (vs importing JOB_ENV_KEY from jobs/state) to match the
  // require()-gated jobs/ import pattern above; spawn.test.ts asserts the
  // string matches.
  if (
    feature('TEMPLATES') &&
    process.env.CLAUDE_JOB_DIR &&
    querySource.startsWith('repl_main_thread') &&
    !toolUseContext.agentId
  ) {
    // Full turn history — assistantMessages resets each queryLoop iteration,
    // so tool calls from earlier iterations (Agent spawn, then summary) need
    // messagesForQuery to be visible in the tool-call summary.
    const turnAssistantMessages = stopHookContext.messages.filter(
      (m): m is AgentAssistantMessage => m.type === 'assistant',
    )
    const p = getAgentHostBindings().classifyJobState?.(
      process.env.CLAUDE_JOB_DIR,
      turnAssistantMessages,
    )?.catch(err => {
      getAgentHostBindings().logDebug?.(`[job] classifier error: ${errorMessage(err)}`)
    }) ?? Promise.resolve()
    await Promise.race([
      p,
      // eslint-disable-next-line no-restricted-syntax -- sleep() has no .unref(); timer must not block exit
      new Promise<void>(r => setTimeout(r, 60_000).unref()),
    ])
  }
  // --bare / SIMPLE: skip background bookkeeping (prompt suggestion,
  // memory extraction, auto-dream). Scripted -p calls don't want auto-memory
  // or forked agents contending for resources during shutdown.
  if (!isBareMode()) {
    // Inline env check for dead code elimination in external builds
    if (!isEnvDefinedFalsy(process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION)) {
      void getAgentHostBindings().executePromptSuggestion?.(stopHookContext)
    }
    if (
      feature('EXTRACT_MEMORIES') &&
      !toolUseContext.agentId &&
      isExtractModeActive()
    ) {
      // Fire-and-forget in both interactive and non-interactive. For -p/SDK,
      // print.ts drains the in-flight promise after flushing the response
      // but before gracefulShutdownSync (see drainPendingExtraction).
      void executeExtractMemories(
        stopHookContext,
        toolUseContext.appendSystemMessage,
      )
    }
    if (!toolUseContext.agentId) {
      void executeAutoDream(stopHookContext, toolUseContext.appendSystemMessage)
    }
  }

  // chicago MCP: auto-unhide + lock release at turn end.
  // Main thread only — the CU lock is a process-wide module-level variable,
  // so a subagent's stopHooks releasing it leaves the main thread's cleanup
  // seeing isLockHeldLocally()===false → no exit notification, and unhides
  // mid-turn. Subagents don't start CU sessions so this is a pure skip.
  if (feature('CHICAGO_MCP') && !toolUseContext.agentId) {
    try {
      await getAgentHostBindings().cleanupComputerUseAfterTurn?.(toolUseContext)
    } catch {
      // Failures are silent — this is dogfooding cleanup, not critical path
    }
  }

  try {
    const blockingErrors = []
    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode

    const generator = getAgentHostBindings().executeStopHooks?.(
      permissionMode,
      toolUseContext.abortController.signal,
      undefined,
      stopHookActive ?? false,
      toolUseContext.agentId,
      toolUseContext,
      [...messagesForQuery, ...assistantMessages],
      toolUseContext.agentType,
    ) ?? (async function* () {})() as AsyncGenerator<never, void>

    // Consume all progress messages and get blocking errors
    let stopHookToolUseID = ''
    let hookCount = 0
    let preventedContinuation = false
    let stopReason = ''
    let hasOutput = false
    const hookErrors: string[] = []
    const hookInfos: AgentStopHookInfo[] = []

    for await (const result of generator) {
      if (result.message) {
        yield result.message
        // Track toolUseID from progress messages and count hooks
        if (result.message.type === 'progress' && result.message.toolUseID) {
          stopHookToolUseID = result.message.toolUseID as string
          hookCount++
          // Extract hook command and prompt text from progress data
          const progressData = result.message.data as AgentHookProgress
          if (progressData.command) {
            hookInfos.push({
              command: progressData.command,
              promptText: progressData.promptText,
            })
          }
        }
        // Track errors and output from attachments
        if (result.message.type === 'attachment') {
          const attachment = result.message.attachment
          if (
            'hookEvent' in attachment &&
            (attachment.hookEvent === 'Stop' ||
              attachment.hookEvent === 'SubagentStop')
          ) {
            if (attachment.type === 'hook_non_blocking_error') {
              hookErrors.push(
                (attachment.stderr as string) || `Exit code ${attachment.exitCode}`,
              )
              // Non-blocking errors always have output
              hasOutput = true
            } else if (attachment.type === 'hook_error_during_execution') {
              hookErrors.push(attachment.content as string)
              hasOutput = true
            } else if (attachment.type === 'hook_success') {
              // Check if successful hook produced any stdout/stderr
              if (
                (attachment.stdout && (attachment.stdout as string).trim()) ||
                (attachment.stderr && (attachment.stderr as string).trim())
              ) {
                hasOutput = true
              }
            }
            // Extract per-hook duration for timing visibility.
            // Hooks run in parallel; match by command + first unassigned entry.
            if ('durationMs' in attachment && 'command' in attachment) {
              const info = hookInfos.find(
                i =>
                  i.command === attachment.command &&
                  i.durationMs === undefined,
              )
              if (info) {
                info.durationMs = attachment.durationMs as number
              }
            }
          }
        }
      }
      if (result.blockingError) {
        const userMessage = getAgentHostBindings().createUserMessage?.({
          content: getAgentHostBindings().getStopHookMessage?.(result.blockingError) ?? '',
          isMeta: true, // Hide from UI (shown in summary message instead)
        })
        blockingErrors.push(userMessage)
        yield userMessage
        hasOutput = true
        // Add to hookErrors so it appears in the summary
        hookErrors.push(result.blockingError.blockingError)
      }
      // Check if hook wants to prevent continuation
      if (result.preventContinuation) {
        preventedContinuation = true
        stopReason = result.stopReason || 'Stop hook prevented continuation'
        // Create attachment to track the stopped continuation (for structured data)
        const stoppedMsg = getAgentHostBindings().createAttachmentMessage?.({
          type: 'hook_stopped_continuation',
          message: stopReason,
          hookName: 'Stop',
          toolUseID: stopHookToolUseID,
          hookEvent: 'Stop',
        })
        if (stoppedMsg) yield stoppedMsg
      }

      // Check if we were aborted during hook execution
      if (toolUseContext.abortController.signal.aborted) {
        getAgentHostBindings().logEvent?.('tengu_pre_stop_hooks_cancelled', {
          queryChainId: toolUseContext.queryTracking
            ?.chainId as unknown as string,
          queryDepth: toolUseContext.queryTracking?.depth,
        })
        const interruptMsg = getAgentHostBindings().createUserInterruptionMessage?.({
          toolUse: false,
        })
        if (interruptMsg) yield interruptMsg
        return { blockingErrors: [], preventContinuation: true }
      }
    }

    // Create summary system message if hooks ran
    if (hookCount > 0) {
      const summaryMsg = getAgentHostBindings().createStopHookSummaryMessage?.(
        hookCount,
        hookInfos,
        hookErrors,
        preventedContinuation,
        stopReason,
        hasOutput,
        'suggestion',
        stopHookToolUseID,
      )
      if (summaryMsg) yield summaryMsg

      // Send notification about errors (shown in verbose/transcript mode via ctrl+o)
      if (hookErrors.length > 0) {
        const expandShortcut = getAgentHostBindings().getShortcutDisplay?.(
          'app:toggleTranscript',
          'Global',
          'ctrl+o',
        ) ?? 'ctrl+o'
        toolUseContext.addNotification?.({
          key: 'stop-hook-error',
          text: `Stop hook error occurred \u00b7 ${expandShortcut} to see`,
          priority: 'immediate',
        })
      }
    }

    if (preventedContinuation) {
      return { blockingErrors: [], preventContinuation: true }
    }

    // Collect blocking errors from stop hooks
    if (blockingErrors.length > 0) {
      return { blockingErrors, preventContinuation: false }
    }

    // After Stop hooks pass, run TeammateIdle and TaskCompleted hooks if this is a teammate
    if (getAgentHostBindings().isTeammate?.()) {
      const teammateName = getAgentHostBindings().getAgentName?.() ?? ''
      const teamName = getAgentHostBindings().getTeamName?.() ?? ''
      const teammateBlockingErrors: AgentMessage[] = []
      let teammatePreventedContinuation = false
      let teammateStopReason: string | undefined
      // Each hook executor generates its own toolUseID — capture from progress
      // messages (same pattern as stopHookToolUseID at L142), not the Stop ID.
      let teammateHookToolUseID = ''

      // Run TaskCompleted hooks for any in-progress tasks owned by this teammate
      const taskListId = getAgentHostBindings().getTaskListId?.()
      const tasks = await getAgentHostBindings().listTasks?.(taskListId) ?? []
      const inProgressTasks = tasks.filter(
        t => t.status === 'in_progress' && t.owner === teammateName,
      )

      for (const task of inProgressTasks) {
        const taskCompletedGenerator = getAgentHostBindings().executeTaskCompletedHooks?.(
          task.id,
          task.subject,
          task.description,
          teammateName,
          teamName,
          permissionMode,
          toolUseContext.abortController.signal,
          undefined,
          toolUseContext,
        ) ?? (async function* () {})() as AsyncGenerator<never, void>

        for await (const result of taskCompletedGenerator) {
          if (result.message) {
            if (
              result.message.type === 'progress' &&
              result.message.toolUseID
            ) {
              teammateHookToolUseID = result.message.toolUseID as string
            }
            yield result.message
          }
          if (result.blockingError) {
            const userMessage = getAgentHostBindings().createUserMessage?.({
              content: getAgentHostBindings().getTaskCompletedHookMessage?.(result.blockingError) ?? '',
              isMeta: true,
            })
            teammateBlockingErrors.push(userMessage)
            yield userMessage
          }
          // Match Stop hook behavior: allow preventContinuation/stopReason
          if (result.preventContinuation) {
            teammatePreventedContinuation = true
            teammateStopReason =
              result.stopReason || 'TaskCompleted hook prevented continuation'
            const taskStoppedMsg = getAgentHostBindings().createAttachmentMessage?.({
              type: 'hook_stopped_continuation',
              message: teammateStopReason,
              hookName: 'TaskCompleted',
              toolUseID: teammateHookToolUseID,
              hookEvent: 'TaskCompleted',
            })
            if (taskStoppedMsg) yield taskStoppedMsg
          }
          if (toolUseContext.abortController.signal.aborted) {
            return { blockingErrors: [], preventContinuation: true }
          }
        }
      }

      // Run TeammateIdle hooks
      const teammateIdleGenerator = getAgentHostBindings().executeTeammateIdleHooks?.(
        teammateName,
        teamName,
        permissionMode,
        toolUseContext.abortController.signal,
      ) ?? (async function* () {})() as AsyncGenerator<never, void>

      for await (const result of teammateIdleGenerator) {
        if (result.message) {
          if (result.message.type === 'progress' && result.message.toolUseID) {
            teammateHookToolUseID = result.message.toolUseID as string
          }
          yield result.message
        }
        if (result.blockingError) {
          const userMessage = getAgentHostBindings().createUserMessage?.({
            content: getAgentHostBindings().getTeammateIdleHookMessage?.(result.blockingError) ?? '',
            isMeta: true,
          })
          if (userMessage) {
            teammateBlockingErrors.push(userMessage)
            yield userMessage
          }
        }
        // Match Stop hook behavior: allow preventContinuation/stopReason
        if (result.preventContinuation) {
          teammatePreventedContinuation = true
          teammateStopReason =
            result.stopReason || 'TeammateIdle hook prevented continuation'
          const idleStoppedMsg = getAgentHostBindings().createAttachmentMessage?.({
            type: 'hook_stopped_continuation',
            message: teammateStopReason,
            hookName: 'TeammateIdle',
            toolUseID: teammateHookToolUseID,
            hookEvent: 'TeammateIdle',
          })
          if (idleStoppedMsg) yield idleStoppedMsg
        }
        if (toolUseContext.abortController.signal.aborted) {
          return { blockingErrors: [], preventContinuation: true }
        }
      }

      if (teammatePreventedContinuation) {
        return { blockingErrors: [], preventContinuation: true }
      }

      if (teammateBlockingErrors.length > 0) {
        return {
          blockingErrors: teammateBlockingErrors,
          preventContinuation: false,
        }
      }
    }

    return { blockingErrors: [], preventContinuation: false }
  } catch (error) {
    const durationMs = Date.now() - hookStartTime
    getAgentHostBindings().logEvent?.('tengu_stop_hook_error', {
      duration: durationMs,
      queryChainId: toolUseContext.queryTracking?.chainId as unknown as string,
      queryDepth: toolUseContext.queryTracking?.depth,
    })
    // Yield a system message that is not visible to the model for the user
    // to debug their hook.
    const sysMsg = getAgentHostBindings().createSystemMessage?.(
      `Stop hook failed: ${errorMessage(error)}`,
      'warning',
    )
    if (sysMsg) yield sysMsg
    return { blockingErrors: [], preventContinuation: false }
  }
}
