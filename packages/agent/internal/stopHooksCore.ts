import { feature } from 'bun:bundle'
import {
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
import { readEnv } from '@claude-code/config/env'
import { logEvent as obsLogEvent } from '@claude-code/local-observability'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import {
  addSessionHook,
  getSessionHooks,
  removeSessionHook,
} from '../hooks/sessionHooks.js'
import { getTotalOutputTokens } from '@claude-code/app-host/bootstrap/state.js'


type StopHookResult = {
  blockingErrors: AgentMessage[]
  preventContinuation: boolean
}

/**
 * Resolve the consecutive Stop-hook block cap. ant v2.1.143 3999.js:
 *   parseInt(env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP) ?? 8, then `cap > 0 && n > cap`.
 *
 * - unset / non-numeric → 8 (the default backstop)
 * - 0 or negative       → disabled (the `cap > 0` guard below short-circuits)
 * - positive N          → N
 */
export function resolveStopHookBlockCap(envValue: string | undefined): number {
  const parsed = Number.parseInt(envValue ?? '', 10)
  return Number.isNaN(parsed) ? 8 : parsed
}

/**
 * Decide what happens after a Stop hook blocks the turn from ending — ant
 * v2.1.143 3999.js consecutive-block guard.
 *
 * A `/goal` Stop hook whose condition can never be satisfied blocks every
 * cycle, and each block injects a blockingError into the transcript. Left
 * unbounded the transcript grows until the main API call 413s
 * ("Prompt is too long"). This is the structural backstop: bound the streak
 * by maxTurns AND by CLAUDE_CODE_STOP_HOOK_BLOCK_CAP (default 8). The
 * `impossible` evaluator verdict (execPromptHook) can short-circuit some
 * cases but relies on the evaluator volunteering it — the cap is the guarantee.
 *
 * Pure decision function: query.ts owns the yield/state-construction; this
 * owns the arithmetic so it can be unit-locked without the generator loop.
 */
export type StopHookBlockDecision =
  | { kind: 'continue'; nextTurnCount: number; nextBlockingCount: number }
  | { kind: 'max_turns'; nextTurnCount: number; nextBlockingCount: number }
  | { kind: 'cap_exceeded'; nextBlockingCount: number }

export function evaluateStopHookBlockOutcome(params: {
  turnCount: number
  blockingCount: number
  maxTurns: number | undefined
  blockCapEnv: string | undefined
}): StopHookBlockDecision {
  const nextTurnCount = params.turnCount + 1
  const nextBlockingCount = params.blockingCount + 1

  // maxTurns bounds blocking loops too — without this a blocking Stop hook
  // would re-query forever in headless mode regardless of --max-turns.
  if (params.maxTurns && nextTurnCount > params.maxTurns) {
    return { kind: 'max_turns', nextTurnCount, nextBlockingCount }
  }

  const blockCap = resolveStopHookBlockCap(params.blockCapEnv)
  if (blockCap > 0 && nextBlockingCount > blockCap) {
    return { kind: 'cap_exceeded', nextBlockingCount }
  }

  return { kind: 'continue', nextTurnCount, nextBlockingCount }
}

/** ant v2.1.143 3999.js cap-override message — verbatim. */
export function stopHookBlockCapMessage(blockingCount: number): string {
  return (
    `A hook blocked the turn from ending ${blockingCount} consecutive times — overriding and ending turn. ` +
    "For Stop/SubagentStop hooks, check stop_hook_active in the input and return success while it's true. Set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP to raise this limit."
  )
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
    readEnv('CLAUDE_JOB_DIR') &&
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
      readEnv('CLAUDE_JOB_DIR'),
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
    if (!isEnvDefinedFalsy(readEnv('CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION'))) {
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

  // ant v2.1.143 3993.js Va7: if a /goal hook is active AND background
  // work is in flight (in-progress / running tasks owned by a teammate),
  // temporarily remove the goal Stop hook before evaluating. Otherwise
  // every Stop tick re-evaluates an unfinished goal while subagents are
  // still working, burning Haiku calls and producing noisy "Goal not yet
  // met" attachments. The hook is restored in the finally block below.
  let deferredGoalHook:
    | { type: 'prompt'; prompt: string }
    | undefined
  try {
    const blockingErrors = []
    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode

    {
      const activeGoal = (
        appState as { activeGoal?: { condition: string } }
      ).activeGoal
      if (activeGoal) {
        try {
          const taskListId = getAgentHostBindings().getTaskListId?.()
          const tasks = (await getAgentHostBindings().listTasks?.(taskListId)) ?? []
          const hasBgWork = tasks.some(
            t =>
              (t.status === 'in_progress' || t.status === 'running') &&
              t.owner !== undefined,
          )
          if (hasBgWork) {
            const sessionId =
              getAgentHostBindings().getSessionId?.() ?? ''
            const hooksMap = getSessionHooks(appState, sessionId, 'Stop')
            const stop = hooksMap.get('Stop') ?? []
            for (const matcher of stop) {
              if (matcher.matcher !== '' || matcher.skillRoot !== undefined)
                continue
              for (const hookEntry of matcher.hooks) {
                const h = hookEntry as { hook?: { type: string; prompt?: string } }
                if (
                  h.hook?.type === 'prompt' &&
                  h.hook.prompt === activeGoal.condition
                ) {
                  deferredGoalHook = {
                    type: 'prompt',
                    prompt: h.hook.prompt,
                  }
                  removeSessionHook(
                    toolUseContext.setAppState,
                    sessionId,
                    'Stop',
                    deferredGoalHook,
                  )
                  break
                }
              }
              if (deferredGoalHook) break
            }
          }
        } catch {
          // Defer is an optimisation — if listTasks errors, fall through
          // to normal hook evaluation rather than crashing the Stop pipeline.
        }
      }
    }

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
              // Port of ant v2.1.136 (3973.js hd7): /goal Stop hook met.
              // When the executed hook is the active goal's prompt hook
              // and it returned successfully, the condition is satisfied:
              //   1. Bump iterations from activeGoal.iterations + 1.
              //   2. Compute durationMs from (now - activeGoal.setAt).
              //   3. Remove the Stop hook so future stops aren't gated.
              //   4. Clear AppState.activeGoal.
              //   5. Emit goal_status `{met:true, condition, reason,
              //      iterations, durationMs}` (NO sentinel — the
              //      findMostRecentMetGoalStatus lookback skips sentinels).
              //   6. logEvent `tengu_goal_achieved {promptLength,
              //      iterations, durationMs}`.
              //   7. logForDebugging `goal_met`.
              if (
                result.message.attachment.hookEvent === 'Stop' &&
                'hook' in result &&
                result.hook &&
                (result.hook as { type: string }).type === 'prompt'
              ) {
                const hookPrompt = (result.hook as { prompt: string }).prompt
                const appState = toolUseContext.getAppState()
                const activeGoal = (
                  appState as {
                    activeGoal?: {
                      condition: string
                      iterations: number
                      setAt: number
                      tokensAtStart: number
                      paused?: boolean
                    }
                  }
                ).activeGoal
                if (activeGoal && !activeGoal.paused && activeGoal.condition === hookPrompt) {
                  const iterations = activeGoal.iterations + 1
                  const durationMs = Date.now() - activeGoal.setAt
                  const tokens = getTotalOutputTokens() - activeGoal.tokensAtStart
                  // ant v2.1.143 3993.js: when evaluator judged the goal
                  // impossible, the hook still returns `outcome:'success'`
                  // (so the Stop hook is removed and activeGoal cleared),
                  // but stopHooksCore branches into the failure path:
                  // emits `goal_status {met:false, failed:true}` + fires
                  // `tengu_goal_failed`. The achievement path is skipped.
                  const isImpossible =
                    (result as { impossible?: boolean }).impossible === true
                  const stopReason = (result as { stopReason?: string }).stopReason
                  try {
                    removeSessionHook(
                      toolUseContext.setAppState,
                      getAgentHostBindings().getSessionId?.() ?? '',
                      'Stop',
                      result.hook as Parameters<
                        typeof removeSessionHook
                      >[3],
                    )
                  } catch {
                    // best-effort cleanup
                  }
                  toolUseContext.setAppState(prev => ({
                    ...prev,
                    activeGoal: undefined,
                  }))
                  if (isImpossible) {
                    const goalFailed = getAgentHostBindings().createAttachmentMessage?.(
                      {
                        type: 'goal_status',
                        met: false,
                        failed: true,
                        condition: hookPrompt,
                        reason: stopReason,
                        iterations,
                        durationMs,
                        tokens,
                      },
                    )
                    if (goalFailed) yield goalFailed
                    try {
                      obsLogEvent('tengu_goal_failed', {
                        promptLength: hookPrompt.length,
                        reasonLength: stopReason?.length ?? 0,
                        iterations,
                        durationMs,
                        tokens,
                      })
                    } catch {
                      // telemetry sink might be uninstalled — fine
                    }
                    try {
                      logForDebugging('goal_met:impossible')
                    } catch {
                      // best-effort diagnostic
                    }
                  } else {
                    const goalMet = getAgentHostBindings().createAttachmentMessage?.(
                      {
                        type: 'goal_status',
                        met: true,
                        condition: hookPrompt,
                        reason: stopReason,
                        iterations,
                        durationMs,
                        tokens,
                      },
                    )
                    if (goalMet) yield goalMet
                    try {
                      obsLogEvent('tengu_goal_achieved', {
                        promptLength: hookPrompt.length,
                        iterations,
                        durationMs,
                        tokens,
                      })
                    } catch {
                      // telemetry sink might be uninstalled — fine
                    }
                    try {
                      logForDebugging('goal_met')
                    } catch {
                      // best-effort diagnostic
                    }
                  }
                }
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

        // Detect /goal blocking: the prompt hook's `prompt` field matches
        // AppState.activeGoal.condition. ant v2.1.142 3991.js Qo7 branches
        // here — goal hooks DON'T contribute to hookErrors (they render via
        // the dim `○ Goal not yet met` attachment instead, not the "Ran N
        // stop hooks / Stop hook error: ..." summary block).
        let isGoalBlock = false
        if (
          'hook' in result &&
          result.hook &&
          (result.hook as { type: string }).type === 'prompt'
        ) {
          const hookPrompt = (result.hook as { prompt: string }).prompt
          const appState = toolUseContext.getAppState()
          const activeGoal = (
            appState as {
              activeGoal?: {
                condition: string
                iterations: number
                setAt: number
                lastReason?: string
                paused?: boolean
              }
            }
          ).activeGoal
          if (activeGoal && !activeGoal.paused && activeGoal.condition === hookPrompt) {
            isGoalBlock = true
            const reason = (result as { stopReason?: string }).stopReason
            // Port of ant 3991.js Qo7 + 3973.js hd7 blocking branch:
            //   /goal not yet met — increment iterations, record lastReason
            //   so renderActiveGoalStatus shows "Last check: <reason>",
            //   surface goal_status `{met:false, condition, reason}` (no
            //   sentinel) so the model sees it must keep going. Hook stays.
            toolUseContext.setAppState(prev => ({
              ...prev,
              activeGoal: {
                ...(prev as { activeGoal: typeof activeGoal }).activeGoal!,
                iterations: activeGoal.iterations + 1,
                lastReason: reason,
              },
            }))
            const notMet = getAgentHostBindings().createAttachmentMessage?.({
              type: 'goal_status',
              met: false,
              condition: hookPrompt,
              reason,
            })
            if (notMet) yield notMet
          }
        }

        // Only non-goal blocking errors contribute to the "Ran N stop hooks"
        // summary. Goal hooks have their own dim status line.
        if (!isGoalBlock) {
          hookErrors.push(result.blockingError.blockingError)
        }
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
  } finally {
    // ant v2.1.143 3993.js Va7: restore the deferred /goal hook so the
    // next turn re-evaluates after background work finishes. Skipped when
    // the met-handler already removed the hook (we only defer when bg
    // work is running — if the hook fired and met, deferredGoalHook stays
    // set but it was never installed; we still try to re-add. The
    // sessionHooksRegistry add is idempotent on shape, so re-installing
    // an already-installed condition is a no-op.) Wrap in try/catch
    // because finally runs even on abort, and we never want a finally
    // failure to mask the original error.
    if (deferredGoalHook) {
      try {
        const sessionId = getAgentHostBindings().getSessionId?.() ?? ''
        const currentGoal = (
          toolUseContext.getAppState() as {
            activeGoal?: { condition: string }
          }
        ).activeGoal
        // Only restore if the goal is still active (met-handler may have
        // cleared activeGoal during the loop above).
        if (currentGoal?.condition === deferredGoalHook.prompt) {
          addSessionHook(
            toolUseContext.setAppState,
            sessionId,
            'Stop',
            '',
            deferredGoalHook,
          )
        }
      } catch {
        // best-effort
      }
    }
  }
}
