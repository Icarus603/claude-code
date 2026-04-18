/**
 * V7 §8.21 — extra host bindings passed through bootstrap.
 *
 * Without these, optional-chain fallbacks inside each package produce
 * undefined/'unknown' values that corrupt user-visible state — e.g. agent's
 * `buildSystemInitMessage?.()` returning undefined crashed the SDK loop, and
 * permission's `getSessionId?.() ?? 'unknown'` wrote summaries to
 * `<cwd>/unknown/session-memory/summary.md`.
 *
 * All `require('src/services/...')` calls stay HERE (never in packages/app-host/src/ —
 * see memory: no-require-in-apphost).
 */

/** Shared `require` fallbacks keep permission/agent/memory session paths aligned. */
export function buildAgentHostExtraBindings(): Record<string, unknown> {
  return {
    getCwdState: () => {
      try {
        return require('src/services/bootstrap/state.js').getCwdState()
      } catch {
        return process.cwd()
      }
    },
    setCwdState: (cwd: string) => {
      try {
        require('src/services/bootstrap/state.js').setCwdState(cwd)
      } catch {}
    },
    getSdkBetas: () => {
      try {
        return require('src/services/bootstrap/state.js').getSdkBetas()
      } catch {
        return []
      }
    },
    getSessionId: () => {
      try {
        return require('src/services/bootstrap/state.js').getSessionId()
      } catch {
        return 'unknown'
      }
    },
    getOriginalCwd: () => {
      try {
        return require('src/services/bootstrap/state.js').getOriginalCwd()
      } catch {
        return process.cwd()
      }
    },
    isSessionPersistenceDisabled: () => {
      try {
        return require('src/services/bootstrap/state.js').isSessionPersistenceDisabled()
      } catch {
        return false
      }
    },
    getTotalAPIDuration: () => {
      try {
        return require('src/services/cost-tracker.js').getTotalAPIDuration()
      } catch {
        return 0
      }
    },
    getTotalCost: () => {
      try {
        return require('src/services/cost-tracker.js').getTotalCost()
      } catch {
        return 0
      }
    },
    getModelUsage: () => {
      try {
        return require('src/services/cost-tracker.js').getModelUsage()
      } catch {
        return {}
      }
    },
    getFastModeState: (model: string, fastMode?: boolean) => {
      try {
        return require('src/utils/fastMode.js').getFastModeState(model, fastMode)
      } catch {
        return null
      }
    },
    getInMemoryErrors: () => {
      try {
        return require('src/utils/log.js').getInMemoryErrors()
      } catch {
        return []
      }
    },
    categorizeRetryableAPIError: (error: unknown) => {
      try {
        return require('src/services/services/api/errors.js').categorizeRetryableAPIError(error)
      } catch {
        return error
      }
    },
    microcompactMessages: (...args: unknown[]) => {
      try {
        return require('@claude-code/agent/compaction/microCompact.js').microcompactMessages(...args)
      } catch {
        const [messages] = args
        return Promise.resolve({ messages })
      }
    },
    autoCompactIfNeeded: (...args: unknown[]) => {
      try {
        return require('@claude-code/agent/compaction/autoCompact.js').autoCompactIfNeeded(...args)
      } catch {
        return Promise.resolve({ wasCompacted: false })
      }
    },
    registerStructuredOutputEnforcement: (setAppState: unknown, sessionId: unknown) => {
      try {
        require('src/utils/hooks/hookHelpers.js').registerStructuredOutputEnforcement(setAppState, sessionId)
      } catch {}
    },
    getMainLoopModel: () => {
      try {
        return require('src/utils/model/model.js').getMainLoopModel()
      } catch {
        return ''
      }
    },
    parseUserSpecifiedModel: (model: string) => {
      try {
        return require('src/utils/model/model.js').parseUserSpecifiedModel(model)
      } catch {
        return model
      }
    },
    loadAllPluginsCacheOnly: () => {
      try {
        return require('src/utils/plugins/pluginLoader.js').loadAllPluginsCacheOnly()
      } catch {
        return Promise.resolve({ enabled: [] })
      }
    },
    processUserInput: (params: unknown) => {
      try {
        return require('src/utils/processUserInput/processUserInput.js').processUserInput(params)
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
        return require('src/utils/queryContext.js').fetchSystemPromptParts(params)
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
        return require('src/utils/thinking.js').shouldEnableThinkingByDefault()
      } catch {
        return undefined
      }
    },
    buildSystemInitMessage: (params: unknown) => {
      try {
        return require('src/utils/messages/systemInit.js').buildSystemInitMessage(params)
      } catch {
        return undefined
      }
    },
    sdkCompatToolName: (toolName: string) => {
      try {
        return require('src/utils/messages/systemInit.js').sdkCompatToolName(toolName)
      } catch {
        return toolName
      }
    },
    handleOrphanedPermission: (...args: unknown[]) => {
      try {
        return require('src/utils/queryHelpers.js').handleOrphanedPermission(...args)
      } catch {
        return (async function* () {})()
      }
    },
    isResultSuccessful: (result: unknown, lastStopReason: string | null) => {
      try {
        return require('src/utils/queryHelpers.js').isResultSuccessful(result, lastStopReason)
      } catch {
        return false
      }
    },
    normalizeMessage: (message: unknown) => {
      try {
        return require('src/utils/queryHelpers.js').normalizeMessage(message)
      } catch {
        return (async function* () {})()
      }
    },
    selectableUserMessagesFilter: (message: unknown) => {
      try {
        return require('src/services/components/MessageSelector.js').selectableUserMessagesFilter(message)
      } catch {
        return true
      }
    },
    getCoordinatorUserContext: (mcpClients: ReadonlyArray<{ name: string }>, scratchpadDir?: string) => {
      try {
        return require('src/services/coordinator/coordinatorMode.js').getCoordinatorUserContext(mcpClients, scratchpadDir)
      } catch {
        return {}
      }
    },
    isSnipBoundaryMessage: (message: unknown) => {
      try {
        return require('@claude-code/agent/compaction/snipProjection.js').isSnipBoundaryMessage(message)
      } catch {
        return false
      }
    },
    snipCompactIfNeeded: (messages: unknown[], options?: { force?: boolean }) => {
      try {
        return require('@claude-code/agent/compaction/snipCompact.js').snipCompactIfNeeded(messages, options)
      } catch {
        return undefined
      }
    },
    headlessProfilerCheckpoint: (name: string) => {
      try {
        require('src/utils/headlessProfiler.js').headlessProfilerCheckpoint(name)
      } catch {}
    },
    queryCheckpoint: (name: string) => {
      try {
        require('src/utils/queryProfiler.js').queryCheckpoint(name)
      } catch {}
    },
    notifyCommandLifecycle: (uuid: string, state: 'started' | 'completed') => {
      try {
        require('src/utils/commandLifecycle.js').notifyCommandLifecycle(uuid, state)
      } catch {}
    },
    getCommandsByMaxPriority: (maxPriority: 'now' | 'next' | 'later') => {
      try {
        return require('src/utils/messageQueueManager.js').getCommandsByMaxPriority(maxPriority)
      } catch {
        return []
      }
    },
    removeCommandsFromQueue: (commands: unknown[]) => {
      try {
        require('src/utils/messageQueueManager.js').remove(commands)
      } catch {}
    },
    isSlashCommand: (command: unknown) => {
      try {
        return require('src/utils/messageQueueManager.js').isSlashCommand(command)
      } catch {
        return false
      }
    },
    createCompactBoundaryMessage: (...a: unknown[]) => {
      try {
        return require('src/utils/messages.js').createCompactBoundaryMessage(...a)
      } catch {
        return undefined
      }
    },
    recordTranscript: (...a: unknown[]) => {
      try {
        return require('@claude-code/storage/sessionStorage.js').recordTranscript(...a)
      } catch {
        return Promise.resolve(null)
      }
    },
    flushSessionStorage: () => {
      try {
        return require('@claude-code/storage/sessionStorage.js').flushSessionStorage()
      } catch {
        return Promise.resolve()
      }
    },
    recordContentReplacement: (...a: unknown[]) => {
      try {
        return require('@claude-code/storage/sessionStorage.js').recordContentReplacement(...a)
      } catch {
        return Promise.resolve()
      }
    },
    createDumpPromptsFetch: (agentIdOrSessionId: string) => {
      try {
        return require('src/services/services/api/dumpPrompts.js').createDumpPromptsFetch(agentIdOrSessionId)
      } catch {
        return (input: RequestInfo | URL, init?: RequestInit) =>
          globalThis.fetch(input, init)
      }
    },
    fallbackTriggeredErrorCtor: () => {
      try {
        return require('src/services/services/api/withRetry.js').FallbackTriggeredError
      } catch {
        return undefined
      }
    },
    imageSizeErrorCtor: () => {
      try {
        return require('src/utils/imageValidation.js').ImageSizeError
      } catch {
        return undefined
      }
    },
    imageResizeErrorCtor: () => {
      try {
        return require('src/utils/imageResizer.js').ImageResizeError
      } catch {
        return undefined
      }
    },
    promptTooLongErrorMessage: (() => {
      try {
        return require('src/services/services/api/errors.js').PROMPT_TOO_LONG_ERROR_MESSAGE
      } catch {
        return ''
      }
    })(),
    isPromptTooLongMessage: (message: unknown) => {
      try {
        return require('src/services/services/api/errors.js').isPromptTooLongMessage(message)
      } catch {
        return false
      }
    },
    normalizeMessagesForAPI: (messages: unknown[], tools: unknown[]) => {
      try {
        return require('src/utils/messages.js').normalizeMessagesForAPI(messages, tools)
      } catch {
        return messages
      }
    },
    getMessagesAfterCompactBoundary: (messages: unknown[]) => {
      try {
        return require('src/utils/messages.js').getMessagesAfterCompactBoundary(messages)
      } catch {
        return messages
      }
    },
    stripSignatureBlocks: (messages: unknown[]) => {
      try {
        return require('src/utils/messages.js').stripSignatureBlocks(messages)
      } catch {
        return messages
      }
    },
    generateToolUseSummary: (params: unknown) => {
      try {
        return require('src/services/services/toolUseSummary/toolUseSummaryGenerator.js').generateToolUseSummary(params)
      } catch {
        return Promise.resolve(null)
      }
    },
    prependUserContext: (messages: unknown[], userContext: Record<string, string>) => {
      try {
        return require('src/utils/api.js').prependUserContext(messages, userContext)
      } catch {
        return messages
      }
    },
    appendSystemContext: (systemPrompt: readonly string[], systemContext: Record<string, string>) => {
      try {
        return require('src/utils/api.js').appendSystemContext(systemPrompt, systemContext)
      } catch {
        return systemPrompt
      }
    },
    createAttachmentMessage: (attachment: unknown) => {
      try {
        return require('src/utils/attachments.js').createAttachmentMessage(attachment)
      } catch {
        return undefined
      }
    },
    filterDuplicateMemoryAttachments: (attachments: unknown[], readFileState: unknown) => {
      try {
        return require('src/utils/attachments.js').filterDuplicateMemoryAttachments(attachments, readFileState)
      } catch {
        return attachments
      }
    },
    getAttachmentMessages: (...args: unknown[]) => {
      try {
        return require('src/utils/attachments.js').getAttachmentMessages(...args)
      } catch {
        return (async function* () {})()
      }
    },
    startRelevantMemoryPrefetch: (...args: unknown[]) => {
      try {
        return require('src/utils/attachments.js').startRelevantMemoryPrefetch(...args)
      } catch {
        return undefined
      }
    },
    startSkillDiscoveryPrefetch: (...args: unknown[]) => {
      try {
        return require('src/services/services/skillSearch/prefetch.js').startSkillDiscoveryPrefetch(...args)
      } catch {
        return undefined
      }
    },
    collectSkillDiscoveryPrefetch: (...args: unknown[]) => {
      try {
        return require('src/services/services/skillSearch/prefetch.js').collectSkillDiscoveryPrefetch(...args)
      } catch {
        return Promise.resolve([])
      }
    },
    getRuntimeMainLoopModel: (params: unknown) => {
      try {
        return require('src/utils/model/model.js').getRuntimeMainLoopModel(params)
      } catch {
        return ''
      }
    },
    renderModelName: (model: string) => {
      try {
        return require('src/utils/model/model.js').renderModelName(model)
      } catch {
        return model
      }
    },
    doesMostRecentAssistantMessageExceed200k: (messages: unknown[]) => {
      try {
        return require('src/utils/tokens.js').doesMostRecentAssistantMessageExceed200k(messages)
      } catch {
        return false
      }
    },
    finalContextTokensFromLastResponse: (messages: unknown[]) => {
      try {
        return require('src/utils/tokens.js').finalContextTokensFromLastResponse(messages)
      } catch {
        return 0
      }
    },
    tokenCountWithEstimation: (messages: unknown[]) => {
      try {
        return require('src/utils/tokens.js').tokenCountWithEstimation(messages)
      } catch {
        return 0
      }
    },
    escalatedMaxTokens: (() => {
      try {
        return require('src/utils/context.js').ESCALATED_MAX_TOKENS
      } catch {
        return 64000
      }
    })(),
    getContextWindowForModel: (model: string) => {
      try {
        return require('src/utils/context.js').getContextWindowForModel(model)
      } catch {
        return 0
      }
    },
    executePostSamplingHooks: (...args: unknown[]) => {
      try {
        require('src/utils/hooks/postSamplingHooks.js').executePostSamplingHooks(...args)
      } catch {}
    },
    createStreamingToolExecutor: (...args: unknown[]) => {
      try {
        const { StreamingToolExecutor } = require('src/services/services/tools/StreamingToolExecutor.js')
        return new StreamingToolExecutor(...args)
      } catch {
        return null
      }
    },
    runTools: (...args: unknown[]) => {
      try {
        return require('src/services/services/tools/toolOrchestration.js').runTools(...args)
      } catch {
        return (async function* () {})()
      }
    },
    applyToolResultBudget: (...args: unknown[]) => {
      try {
        return require('src/utils/toolResultStorage.js').applyToolResultBudget(...args)
      } catch {
        const [messages] = args
        return Promise.resolve(messages)
      }
    },
    snipCompactWithMetadata: (messages: unknown[]) => {
      try {
        return require('@claude-code/agent/compaction/snipCompact.js').snipCompactIfNeeded(messages)
      } catch {
        return { messages, tokensFreed: 0 }
      }
    },
    applyContextCollapsesIfNeeded: (...args: unknown[]) => {
      try {
        return require('@claude-code/agent/contextCollapse/index.js').applyCollapsesIfNeeded(...args)
      } catch {
        const [messages] = args
        return Promise.resolve({ messages })
      }
    },
    recoverContextCollapseOverflow: (...args: unknown[]) => {
      try {
        return require('@claude-code/agent/contextCollapse/index.js').recoverFromOverflow(...args)
      } catch {
        const [messages] = args
        return { messages, committed: 0 }
      }
    },
    isContextCollapseEnabled: () => {
      try {
        return require('@claude-code/agent/contextCollapse/index.js').isContextCollapseEnabled()
      } catch {
        return false
      }
    },
    isWithheldContextCollapsePromptTooLong: (message: unknown, querySource: unknown) => {
      try {
        const { isWithheldPromptTooLong } = require('@claude-code/agent/contextCollapse/index.js')
        const { isPromptTooLongMessage } = require('src/services/services/api/errors.js')
        return isWithheldPromptTooLong(message, isPromptTooLongMessage, querySource)
      } catch {
        return false
      }
    },
    isReactiveCompactEnabled: () => {
      try {
        return require('@claude-code/agent/compaction/reactiveCompact.js').isReactiveCompactEnabled()
      } catch {
        return false
      }
    },
    isWithheldReactivePromptTooLong: (message: unknown) => {
      try {
        return require('@claude-code/agent/compaction/reactiveCompact.js').isWithheldPromptTooLong(message)
      } catch {
        return false
      }
    },
    isWithheldReactiveMediaSizeError: (message: unknown) => {
      try {
        return require('@claude-code/agent/compaction/reactiveCompact.js').isWithheldMediaSizeError(message)
      } catch {
        return false
      }
    },
    tryReactiveCompact: (params: unknown) => {
      try {
        return require('@claude-code/agent/compaction/reactiveCompact.js').tryReactiveCompact(params)
      } catch {
        return Promise.resolve(undefined)
      }
    },
    cleanupComputerUseAfterTurn: (toolUseContext: unknown) => {
      try {
        return require('src/utils/computerUse/cleanup.js').cleanupComputerUseAfterTurn(toolUseContext)
      } catch {
        return Promise.resolve()
      }
    },
    shouldGenerateTaskSummary: () => {
      try {
        return require('src/utils/taskSummary.js').shouldGenerateTaskSummary()
      } catch {
        return false
      }
    },
    maybeGenerateTaskSummary: (params: unknown) => {
      try {
        require('src/utils/taskSummary.js').maybeGenerateTaskSummary(params)
      } catch {}
    },
  }
}

/**
 * Permission host bindings — in particular `getSessionId` and `getProjectDir`
 * that feed `getSessionMemoryDir()` in `packages/permission/src/filesystem.ts`.
 * Without these, session summaries are written under `<cwd>/unknown/`.
 */
export function buildPermissionHostExtraBindings(): Record<string, unknown> {
  return {
    addPermissionRulesToSettings: (...a: unknown[]) => { try { return require('src/utils/permissions/permissionsLoader.js').addPermissionRulesToSettings(...a) } catch { return false } },
    hasAutoMemPathOverride: () => { try { return require('@claude-code/memory/paths').hasAutoMemPathOverride() } catch { return false } },
    isAutoMemPath: (p: string) => { try { return require('@claude-code/memory/paths').isAutoMemPath(p) } catch { return false } },
    isAgentMemoryPath: (p: string) => { try { return require('@claude-code/memory/agentMemory').isAgentMemoryPath(p) } catch { return false } },
    getOriginalCwd: () => { try { return require('src/services/bootstrap/state.js').getOriginalCwd() } catch { return process.cwd() } },
    getSessionId: () => { try { return require('src/services/bootstrap/state.js').getSessionId() } catch { return 'unknown' } },
    getCwd: () => { try { return require('src/utils/cwd.js').getCwd() } catch { return process.cwd() } },
    getConfigHomeDir: () => { try { return require('src/utils/envUtils.js').getClaudeConfigHomeDir() } catch { return '' } },
    getFsImplementation: () => { try { return require('src/utils/fsOperations.js').getFsImplementation() } catch { return require('node:fs') } },
    getPathsForPermissionCheck: (...a: unknown[]) => { try { return require('src/utils/fsOperations.js').getPathsForPermissionCheck(...a) } catch { return [] } },
    containsPathTraversal: (p: string) => { try { return require('src/utils/path.js').containsPathTraversal(p) } catch { return false } },
    expandPath: (p: string, cwd: string) => { try { return require('src/utils/path.js').expandPath(p, cwd) } catch { return p } },
    getDirectoryForPath: (p: string) => { try { return require('src/utils/path.js').getDirectoryForPath(p) } catch { return p } },
    sanitizePath: (p: string) => { try { return require('src/utils/path.js').sanitizePath(p) } catch { return p } },
    getPlanSlug: () => { try { return require('src/utils/plans.js').getPlanSlug() } catch { return undefined } },
    getPlansDirectory: () => { try { return require('src/utils/plans.js').getPlansDirectory() } catch { return '' } },
    getPlatform: () => { try { return require('src/utils/platform.js').getPlatform() } catch { return process.platform === 'darwin' ? 'macos' : 'linux' } },
    getProjectDir: (...a: unknown[]) => { try { return require('@claude-code/storage/sessionStorage.js').getProjectDir(...a) } catch { return process.cwd() } },
    containsVulnerableUncPath: (p: string) => { try { return require('src/utils/shell/readOnlyCommandValidation.js').containsVulnerableUncPath(p) } catch { return false } },
    getToolResultsDir: () => { try { return require('src/utils/toolResultStorage.js').getToolResultsDir() } catch { return '' } },
    shouldUseSandbox: () => { try { return require('@claude-code/tool-registry/tools/BashTool/shouldUseSandbox.js').shouldUseSandbox() } catch { return false } },
    extractOutputRedirections: (cmd: string) => { try { return require('src/utils/bash/commands.js').extractOutputRedirections(cmd) } catch { return [] } },
    deletePermissionRuleFromSettings: (...a: unknown[]) => { try { return require('src/utils/permissions/permissionsLoader.js').deletePermissionRuleFromSettings(...a) } catch { return false } },
    shouldAllowManagedPermissionRulesOnly: () => { try { return require('src/utils/permissions/permissionsLoader.js').shouldAllowManagedPermissionRulesOnly() } catch { return false } },
    classifyPermissionDecision: (...a: unknown[]) => { try { return require('src/utils/permissions/classifierDecision.js').classifyPermissionDecision(...a) } catch { return null } },
    getAutoMode: () => { try { return require('src/utils/permissions/autoModeState.js').getAutoMode() } catch { return null } },
    setAutoMode: (v: unknown) => { try { require('src/utils/permissions/autoModeState.js').setAutoMode(v) } catch {} },
    setDirtyAutoMode: () => { try { require('src/utils/permissions/autoModeState.js').setDirtyAutoMode() } catch {} },
    clearDirtyAutoMode: () => { try { require('src/utils/permissions/autoModeState.js').clearDirtyAutoMode() } catch {} },
    addToTurnClassifierDuration: (ms: number) => { try { require('src/services/bootstrap/state.js').addToTurnClassifierDuration(ms) } catch {} },
    getTotalInputTokens: () => { try { return require('src/services/bootstrap/state.js').getTotalInputTokens() } catch { return 0 } },
    getTotalOutputTokens: () => { try { return require('src/services/bootstrap/state.js').getTotalOutputTokens() } catch { return 0 } },
    getTotalCacheCreationInputTokens: () => { try { return require('src/services/bootstrap/state.js').getTotalCacheCreationInputTokens() } catch { return 0 } },
    getTotalCacheReadInputTokens: () => { try { return require('src/services/bootstrap/state.js').getTotalCacheReadInputTokens() } catch { return 0 } },
    logEvent: (event: string, metadata?: Record<string, unknown>) => { try { (require('@claude-code/local-observability') as typeof import('@claude-code/local-observability')).logEvent(event, metadata) } catch {} },
    sanitizeToolNameForAnalytics: (name: string) => { try { return require('src/services/services/eventMetadata.js').sanitizeToolNameForAnalytics(name) } catch { return name } },
    clearClassifierChecking: () => { try { require('src/utils/classifierApprovals.js').clearClassifierChecking() } catch {} },
    setClassifierChecking: (v: boolean) => { try { require('src/utils/classifierApprovals.js').setClassifierChecking(v) } catch {} },
    isInProtectedNamespace: () => { try { return require('src/utils/envUtils.js').isInProtectedNamespace() } catch { return false } },
    executePermissionRequestHooks: (...a: unknown[]) => { try { return require('src/utils/hooks.js').executePermissionRequestHooks(...a) } catch { return Promise.resolve(null) } },
    buildClassifierUnavailableMessage: () => { try { return require('src/utils/messages.js').buildClassifierUnavailableMessage() } catch { return '' } },
    buildYoloRejectionMessage: (...a: unknown[]) => { try { return require('src/utils/messages.js').buildYoloRejectionMessage(...a) } catch { return '' } },
    calculateCostFromTokens: (...a: unknown[]) => { try { return require('src/utils/modelCost.js').calculateCostFromTokens(...a) } catch { return 0 } },
    isSandboxingEnabled: () => { try { return require('src/utils/sandbox/sandbox-adapter.js').SandboxManager.isSandboxingEnabled() } catch { return false } },
    isAutoAllowBashIfSandboxedEnabled: () => { try { return require('src/utils/sandbox/sandbox-adapter.js').SandboxManager.isAutoAllowBashIfSandboxedEnabled() } catch { return false } },
    classifyYoloAction: (...a: unknown[]) => { try { return require('src/utils/permissions/yoloClassifier.js').classifyYoloAction(...a) } catch { return null } },
    formatActionForClassifier: (...a: unknown[]) => { try { return require('src/utils/permissions/yoloClassifier.js').formatActionForClassifier(...a) } catch { return '' } },
    getToolsForDefaultPreset: () => { try { return require('src/services/tools.js').getToolsForDefaultPreset() } catch { return [] } },
    handleAutoModeTransition: (mode: unknown) => { try { require('src/services/bootstrap/state.js').handleAutoModeTransition(mode) } catch {} },
    handlePlanModeTransition: (mode: unknown) => { try { require('src/services/bootstrap/state.js').handlePlanModeTransition(mode) } catch {} },
    setHasExitedPlanMode: (v: unknown) => { try { require('src/services/bootstrap/state.js').setHasExitedPlanMode(v) } catch {} },
    setNeedsAutoModeExitAttachment: (v: unknown) => { try { require('src/services/bootstrap/state.js').setNeedsAutoModeExitAttachment(v) } catch {} },
    loadAllPermissionRulesFromDisk: () => { try { return require('src/utils/permissions/permissionsLoader.js').loadAllPermissionRulesFromDisk() } catch { return [] } },
    addDirHelpMessage: () => { try { return require('src/services/commands/add-dir/validation.js').addDirHelpMessage() } catch { return '' } },
    validateDirectoryForWorkspace: (dir: unknown, cwd: unknown) => { try { return require('src/services/commands/add-dir/validation.js').validateDirectoryForWorkspace(dir, cwd) } catch { return { valid: true } } },
    parseToolPreset: (preset: unknown) => { try { return require('src/services/tools.js').parseToolPreset(preset) } catch { return [] } },
    safeResolvePath: (fs: unknown, p: unknown) => { try { return require('src/utils/fsOperations.js').safeResolvePath(fs, p) } catch { return { resolvedPath: p } } },
    modelSupportsAutoMode: (model: unknown) => { try { return require('src/utils/betas.js').modelSupportsAutoMode(model) } catch { return false } },
    gracefulShutdown: (code: unknown) => { try { return require('src/utils/gracefulShutdown.js').gracefulShutdown(code) } catch { return Promise.reject(new Error('gracefulShutdown unavailable')) } },
    getMainLoopModel: () => { try { return require('src/utils/model/model.js').getMainLoopModel() } catch { return '' } },
  }
}

/** Memory host bindings — dream task lifecycle hooks. */
export function buildMemoryHostExtraBindings(): Record<string, unknown> {
  type TUC = {
    setAppStateForTasks?: unknown
    setAppState: unknown
    getAppState: () => { tasks?: Record<string, unknown> }
  }
  const setter = (ctx: unknown) => {
    const c = ctx as TUC
    return c.setAppStateForTasks ?? c.setAppState
  }
  return {
    registerDreamTask: (toolUseContext: unknown, params: unknown) => {
      try {
        return require('src/services/tasks/DreamTask/DreamTask.js').registerDreamTask(setter(toolUseContext), params)
      } catch {
        return ''
      }
    },
    addDreamTurn: (
      taskId: string,
      turn: { text: string; toolUseCount: number },
      paths: string[],
      toolUseContext: unknown,
    ) => {
      try {
        require('src/services/tasks/DreamTask/DreamTask.js').addDreamTurn(taskId, turn, paths, setter(toolUseContext))
      } catch {}
    },
    completeDreamTask: (taskId: string, toolUseContext: unknown) => {
      try {
        require('src/services/tasks/DreamTask/DreamTask.js').completeDreamTask(taskId, setter(toolUseContext))
      } catch {}
    },
    failDreamTask: (taskId: string, toolUseContext: unknown) => {
      try {
        require('src/services/tasks/DreamTask/DreamTask.js').failDreamTask(taskId, setter(toolUseContext))
      } catch {}
    },
    getDreamTaskState: (taskId: string, toolUseContext: unknown) => {
      try {
        return (toolUseContext as TUC).getAppState().tasks?.[taskId]
      } catch {
        return undefined
      }
    },
    isDreamTask: (state: unknown) => {
      try {
        return require('src/services/tasks/DreamTask/DreamTask.js').isDreamTask(state)
      } catch {
        return false
      }
    },
  }
}
