/**
 * V7 §8.21 — extra agent host bindings.
 *
 * Bootstrap (`src/runtime/bootstrap.ts`) passes these through to
 * `@claude-code/app-host/packageHostSetup` → `installAgentHostBindings`. Without
 * them, QueryEngine.submitMessage()'s first `yield buildSystemInitMessage(...)`
 * yields `undefined`, crashing the headless SDK loop with
 * "undefined is not an object (evaluating 'message.type')".
 *
 * All `require('../...')` calls stay HERE (never in packages/app-host/src/ —
 * see memory: no-require-in-apphost).
 */
export function buildAgentHostExtraBindings(): Record<string, unknown> {
  return {
    getCwdState: () => {
      try {
        return require('../bootstrap/state.js').getCwdState()
      } catch {
        return process.cwd()
      }
    },
    setCwdState: (cwd: string) => {
      try {
        require('../bootstrap/state.js').setCwdState(cwd)
      } catch {}
    },
    getSdkBetas: () => {
      try {
        return require('../bootstrap/state.js').getSdkBetas()
      } catch {
        return []
      }
    },
    getSessionId: () => {
      try {
        return require('../bootstrap/state.js').getSessionId()
      } catch {
        return 'unknown'
      }
    },
    getOriginalCwd: () => {
      try {
        return require('../bootstrap/state.js').getOriginalCwd()
      } catch {
        return process.cwd()
      }
    },
    isSessionPersistenceDisabled: () => {
      try {
        return require('../bootstrap/state.js').isSessionPersistenceDisabled()
      } catch {
        return false
      }
    },
    getTotalAPIDuration: () => {
      try {
        return require('../cost-tracker.js').getTotalAPIDuration()
      } catch {
        return 0
      }
    },
    getTotalCost: () => {
      try {
        return require('../cost-tracker.js').getTotalCost()
      } catch {
        return 0
      }
    },
    getModelUsage: () => {
      try {
        return require('../cost-tracker.js').getModelUsage()
      } catch {
        return {}
      }
    },
    getFastModeState: (model: string, fastMode?: boolean) => {
      try {
        return require('../utils/fastMode.js').getFastModeState(model, fastMode)
      } catch {
        return null
      }
    },
    getInMemoryErrors: () => {
      try {
        return require('../utils/log.js').getInMemoryErrors()
      } catch {
        return []
      }
    },
    categorizeRetryableAPIError: (error: unknown) => {
      try {
        return require('../services/api/errors.js').categorizeRetryableAPIError(error)
      } catch {
        return error
      }
    },
    microcompactMessages: (...args: unknown[]) => {
      try {
        return require('../services/compact/microCompact.js').microcompactMessages(...args)
      } catch {
        const [messages] = args
        return Promise.resolve({ messages })
      }
    },
    autoCompactIfNeeded: (...args: unknown[]) => {
      try {
        return require('../services/compact/autoCompact.js').autoCompactIfNeeded(...args)
      } catch {
        return Promise.resolve({ wasCompacted: false })
      }
    },
    registerStructuredOutputEnforcement: (setAppState: unknown, sessionId: unknown) => {
      try {
        require('../utils/hooks/hookHelpers.js').registerStructuredOutputEnforcement(setAppState, sessionId)
      } catch {}
    },
    getMainLoopModel: () => {
      try {
        return require('../utils/model/model.js').getMainLoopModel()
      } catch {
        return ''
      }
    },
    parseUserSpecifiedModel: (model: string) => {
      try {
        return require('../utils/model/model.js').parseUserSpecifiedModel(model)
      } catch {
        return model
      }
    },
    loadAllPluginsCacheOnly: () => {
      try {
        return require('../utils/plugins/pluginLoader.js').loadAllPluginsCacheOnly()
      } catch {
        return Promise.resolve({ enabled: [] })
      }
    },
    processUserInput: (params: unknown) => {
      try {
        return require('../utils/processUserInput/processUserInput.js').processUserInput(params)
      } catch {
        return Promise.resolve({
          messages: [],
          shouldQuery: false,
          allowedTools: undefined,
        })
      }
    },
    fetchSystemPromptParts: (params: unknown) => {
      try {
        return require('../utils/queryContext.js').fetchSystemPromptParts(params)
      } catch {
        return Promise.resolve({
          defaultSystemPrompt: [],
          userContext: {},
          systemContext: {},
        })
      }
    },
    shouldEnableThinkingByDefault: () => {
      try {
        return require('../utils/thinking.js').shouldEnableThinkingByDefault()
      } catch {
        return undefined
      }
    },
    buildSystemInitMessage: (params: unknown) => {
      try {
        return require('../utils/messages/systemInit.js').buildSystemInitMessage(params)
      } catch {
        return undefined
      }
    },
    sdkCompatToolName: (toolName: string) => {
      try {
        return require('../utils/messages/systemInit.js').sdkCompatToolName(toolName)
      } catch {
        return toolName
      }
    },
    handleOrphanedPermission: (...args: unknown[]) => {
      try {
        return require('../utils/queryHelpers.js').handleOrphanedPermission(...args)
      } catch {
        return (async function* () {})()
      }
    },
    isResultSuccessful: (result: unknown, lastStopReason: string | null) => {
      try {
        return require('../utils/queryHelpers.js').isResultSuccessful(result, lastStopReason)
      } catch {
        return false
      }
    },
    normalizeMessage: (message: unknown) => {
      try {
        return require('../utils/queryHelpers.js').normalizeMessage(message)
      } catch {
        return (async function* () {})()
      }
    },
    selectableUserMessagesFilter: (message: unknown) => {
      try {
        return require('../components/MessageSelector.js').selectableUserMessagesFilter(message)
      } catch {
        return true
      }
    },
    getCoordinatorUserContext: (mcpClients: ReadonlyArray<{ name: string }>, scratchpadDir?: string) => {
      try {
        return require('../coordinator/coordinatorMode.js').getCoordinatorUserContext(mcpClients, scratchpadDir)
      } catch {
        return {}
      }
    },
    isSnipBoundaryMessage: (message: unknown) => {
      try {
        return require('../services/compact/snipProjection.js').isSnipBoundaryMessage(message)
      } catch {
        return false
      }
    },
    snipCompactIfNeeded: (messages: unknown[], options?: { force?: boolean }) => {
      try {
        return require('../services/compact/snipCompact.js').snipCompactIfNeeded(messages, options)
      } catch {
        return undefined
      }
    },
    headlessProfilerCheckpoint: (name: string) => {
      try {
        require('../utils/headlessProfiler.js').headlessProfilerCheckpoint(name)
      } catch {}
    },
    queryCheckpoint: (name: string) => {
      try {
        require('../utils/queryProfiler.js').queryCheckpoint(name)
      } catch {}
    },
    notifyCommandLifecycle: (uuid: string, state: 'started' | 'completed') => {
      try {
        require('../utils/commandLifecycle.js').notifyCommandLifecycle(uuid, state)
      } catch {}
    },
    getCommandsByMaxPriority: (maxPriority: 'now' | 'next' | 'later') => {
      try {
        return require('../utils/messageQueueManager.js').getCommandsByMaxPriority(maxPriority)
      } catch {
        return []
      }
    },
    removeCommandsFromQueue: (commands: unknown[]) => {
      try {
        require('../utils/messageQueueManager.js').remove(commands)
      } catch {}
    },
    isSlashCommand: (command: unknown) => {
      try {
        return require('../utils/messageQueueManager.js').isSlashCommand(command)
      } catch {
        return false
      }
    },
    createCompactBoundaryMessage: (...a: unknown[]) => {
      try {
        return require('../utils/messages.js').createCompactBoundaryMessage(...a)
      } catch {
        return undefined
      }
    },
    recordTranscript: (...a: unknown[]) => {
      try {
        return require('../utils/sessionStorage.js').recordTranscript(...a)
      } catch {
        return Promise.resolve(null)
      }
    },
    flushSessionStorage: () => {
      try {
        return require('../utils/sessionStorage.js').flushSessionStorage()
      } catch {
        return Promise.resolve()
      }
    },
    recordContentReplacement: (...a: unknown[]) => {
      try {
        return require('../utils/sessionStorage.js').recordContentReplacement(...a)
      } catch {
        return Promise.resolve()
      }
    },
    createDumpPromptsFetch: (agentIdOrSessionId: string) => {
      try {
        return require('../services/api/dumpPrompts.js').createDumpPromptsFetch(agentIdOrSessionId)
      } catch {
        return (input: RequestInfo | URL, init?: RequestInit) =>
          globalThis.fetch(input, init)
      }
    },
    fallbackTriggeredErrorCtor: () => {
      try {
        return require('../services/api/withRetry.js').FallbackTriggeredError
      } catch {
        return undefined
      }
    },
    imageSizeErrorCtor: () => {
      try {
        return require('../utils/imageValidation.js').ImageSizeError
      } catch {
        return undefined
      }
    },
    imageResizeErrorCtor: () => {
      try {
        return require('../utils/imageResizer.js').ImageResizeError
      } catch {
        return undefined
      }
    },
    promptTooLongErrorMessage: (() => {
      try {
        return require('../services/api/errors.js').PROMPT_TOO_LONG_ERROR_MESSAGE
      } catch {
        return ''
      }
    })(),
    isPromptTooLongMessage: (message: unknown) => {
      try {
        return require('../services/api/errors.js').isPromptTooLongMessage(message)
      } catch {
        return false
      }
    },
    normalizeMessagesForAPI: (messages: unknown[], tools: unknown[]) => {
      try {
        return require('../utils/messages.js').normalizeMessagesForAPI(messages, tools)
      } catch {
        return messages
      }
    },
    getMessagesAfterCompactBoundary: (messages: unknown[]) => {
      try {
        return require('../utils/messages.js').getMessagesAfterCompactBoundary(messages)
      } catch {
        return messages
      }
    },
    stripSignatureBlocks: (messages: unknown[]) => {
      try {
        return require('../utils/messages.js').stripSignatureBlocks(messages)
      } catch {
        return messages
      }
    },
    generateToolUseSummary: (params: unknown) => {
      try {
        return require('../services/toolUseSummary/toolUseSummaryGenerator.js').generateToolUseSummary(params)
      } catch {
        return Promise.resolve(null)
      }
    },
    prependUserContext: (messages: unknown[], userContext: Record<string, string>) => {
      try {
        return require('../utils/api.js').prependUserContext(messages, userContext)
      } catch {
        return messages
      }
    },
    appendSystemContext: (systemPrompt: readonly string[], systemContext: Record<string, string>) => {
      try {
        return require('../utils/api.js').appendSystemContext(systemPrompt, systemContext)
      } catch {
        return systemPrompt
      }
    },
    createAttachmentMessage: (attachment: unknown) => {
      try {
        return require('../utils/attachments.js').createAttachmentMessage(attachment)
      } catch {
        return undefined
      }
    },
    filterDuplicateMemoryAttachments: (attachments: unknown[], readFileState: unknown) => {
      try {
        return require('../utils/attachments.js').filterDuplicateMemoryAttachments(attachments, readFileState)
      } catch {
        return attachments
      }
    },
    getAttachmentMessages: (...args: unknown[]) => {
      try {
        return require('../utils/attachments.js').getAttachmentMessages(...args)
      } catch {
        return (async function* () {})()
      }
    },
    startRelevantMemoryPrefetch: (...args: unknown[]) => {
      try {
        return require('../utils/attachments.js').startRelevantMemoryPrefetch(...args)
      } catch {
        return undefined
      }
    },
    startSkillDiscoveryPrefetch: (...args: unknown[]) => {
      try {
        return require('../services/skillSearch/prefetch.js').startSkillDiscoveryPrefetch(...args)
      } catch {
        return undefined
      }
    },
    collectSkillDiscoveryPrefetch: (...args: unknown[]) => {
      try {
        return require('../services/skillSearch/prefetch.js').collectSkillDiscoveryPrefetch(...args)
      } catch {
        return Promise.resolve([])
      }
    },
    getRuntimeMainLoopModel: (params: unknown) => {
      try {
        return require('../utils/model/model.js').getRuntimeMainLoopModel(params)
      } catch {
        return ''
      }
    },
    renderModelName: (model: string) => {
      try {
        return require('../utils/model/model.js').renderModelName(model)
      } catch {
        return model
      }
    },
    doesMostRecentAssistantMessageExceed200k: (messages: unknown[]) => {
      try {
        return require('../utils/tokens.js').doesMostRecentAssistantMessageExceed200k(messages)
      } catch {
        return false
      }
    },
    finalContextTokensFromLastResponse: (messages: unknown[]) => {
      try {
        return require('../utils/tokens.js').finalContextTokensFromLastResponse(messages)
      } catch {
        return 0
      }
    },
    tokenCountWithEstimation: (messages: unknown[]) => {
      try {
        return require('../utils/tokens.js').tokenCountWithEstimation(messages)
      } catch {
        return 0
      }
    },
    escalatedMaxTokens: (() => {
      try {
        return require('../utils/context.js').ESCALATED_MAX_TOKENS
      } catch {
        return 64000
      }
    })(),
    getContextWindowForModel: (model: string) => {
      try {
        return require('../utils/context.js').getContextWindowForModel(model)
      } catch {
        return 0
      }
    },
    executePostSamplingHooks: (...args: unknown[]) => {
      try {
        require('../utils/hooks/postSamplingHooks.js').executePostSamplingHooks(...args)
      } catch {}
    },
    createStreamingToolExecutor: (...args: unknown[]) => {
      try {
        const { StreamingToolExecutor } = require('../services/tools/StreamingToolExecutor.js')
        return new StreamingToolExecutor(...args)
      } catch {
        return null
      }
    },
    runTools: (...args: unknown[]) => {
      try {
        return require('../services/tools/toolOrchestration.js').runTools(...args)
      } catch {
        return (async function* () {})()
      }
    },
    applyToolResultBudget: (...args: unknown[]) => {
      try {
        return require('../utils/toolResultStorage.js').applyToolResultBudget(...args)
      } catch {
        const [messages] = args
        return Promise.resolve(messages)
      }
    },
    snipCompactWithMetadata: (messages: unknown[]) => {
      try {
        return require('../services/compact/snipCompact.js').snipCompactIfNeeded(messages)
      } catch {
        return { messages, tokensFreed: 0 }
      }
    },
    applyContextCollapsesIfNeeded: (...args: unknown[]) => {
      try {
        return require('../services/contextCollapse/index.js').applyCollapsesIfNeeded(...args)
      } catch {
        const [messages] = args
        return Promise.resolve({ messages })
      }
    },
    recoverContextCollapseOverflow: (...args: unknown[]) => {
      try {
        return require('../services/contextCollapse/index.js').recoverFromOverflow(...args)
      } catch {
        const [messages] = args
        return { messages, committed: 0 }
      }
    },
    isContextCollapseEnabled: () => {
      try {
        return require('../services/contextCollapse/index.js').isContextCollapseEnabled()
      } catch {
        return false
      }
    },
    isWithheldContextCollapsePromptTooLong: (message: unknown, querySource: unknown) => {
      try {
        const { isWithheldPromptTooLong } = require('../services/contextCollapse/index.js')
        const { isPromptTooLongMessage } = require('../services/api/errors.js')
        return isWithheldPromptTooLong(message, isPromptTooLongMessage, querySource)
      } catch {
        return false
      }
    },
    isReactiveCompactEnabled: () => {
      try {
        return require('../services/compact/reactiveCompact.js').isReactiveCompactEnabled()
      } catch {
        return false
      }
    },
    isWithheldReactivePromptTooLong: (message: unknown) => {
      try {
        return require('../services/compact/reactiveCompact.js').isWithheldPromptTooLong(message)
      } catch {
        return false
      }
    },
    isWithheldReactiveMediaSizeError: (message: unknown) => {
      try {
        return require('../services/compact/reactiveCompact.js').isWithheldMediaSizeError(message)
      } catch {
        return false
      }
    },
    tryReactiveCompact: (params: unknown) => {
      try {
        return require('../services/compact/reactiveCompact.js').tryReactiveCompact(params)
      } catch {
        return Promise.resolve(undefined)
      }
    },
    cleanupComputerUseAfterTurn: (toolUseContext: unknown) => {
      try {
        return require('../utils/computerUse/cleanup.js').cleanupComputerUseAfterTurn(toolUseContext)
      } catch {
        return Promise.resolve()
      }
    },
    shouldGenerateTaskSummary: () => {
      try {
        return require('../utils/taskSummary.js').shouldGenerateTaskSummary()
      } catch {
        return false
      }
    },
    maybeGenerateTaskSummary: (params: unknown) => {
      try {
        require('../utils/taskSummary.js').maybeGenerateTaskSummary(params)
      } catch {}
    },
  }
}
