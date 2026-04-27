import { installSwarmAppRuntime } from '../adapters/appRuntime.js'
import { installSwarmAppUi } from '../adapters/appUi.js'
import { TEAMMATE_MESSAGE_TAG } from '@claude-code/command-runtime/xml.js'
import {
  processMailboxPermissionResponse,
  registerPermissionCallback,
  unregisterPermissionCallback,
} from '@claude-code/repl/hooks/useSwarmPermissionPoller.js'
import { useExitOnCtrlCDWithKeybindings } from '@claude-code/repl/hooks/useExitOnCtrlCDWithKeybindings.js'
import { Spinner } from '@claude-code/repl/components/Spinner.js'
import {
  type OptionWithDescription,
  Select,
} from '@claude-code/repl/components/CustomSelect/index.js'
import { logEvent } from '@claude-code/local-observability'
import { getAutoCompactThreshold } from '@claude-code/agent/compaction/autoCompact.js'
import {
  buildPostCompactMessages,
  compactConversation,
  ERROR_MESSAGE_USER_ABORT,
} from '@claude-code/agent/compaction/compact.js'
import { resetMicrocompactState } from '@claude-code/agent/compaction/microCompact.js'
import {
  createTaskStateBase,
  generateTaskId,
  isTerminalTaskStatus,
} from '@claude-code/tool-registry/Task.js'
import {
  createActivityDescriptionResolver,
  createProgressTracker,
  getProgressUpdate,
  updateProgressFromMessage,
} from '@claude-code/agent/localAgentTask.js'
import { AGENT_COLORS } from '@claude-code/tool-registry/tools/AgentTool/agentColorManager.js'
import { runAgent } from '@claude-code/tool-registry/tools/AgentTool/runAgent.js'
import { awaitClassifierAutoApproval } from '@claude-code/tool-registry/tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '@claude-code/tool-registry/tools/BashTool/toolName.js'
import { SEND_MESSAGE_TOOL_NAME } from '@claude-code/tool-registry/tools/SendMessageTool/constants.js'
import { TASK_CREATE_TOOL_NAME } from '@claude-code/tool-registry/tools/TaskCreateTool/constants.js'
import { TASK_GET_TOOL_NAME } from '@claude-code/tool-registry/tools/TaskGetTool/constants.js'
import { TASK_LIST_TOOL_NAME } from '@claude-code/tool-registry/tools/TaskListTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '@claude-code/tool-registry/tools/TaskUpdateTool/constants.js'
import { TEAM_CREATE_TOOL_NAME } from '@claude-code/tool-registry/tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '@claude-code/tool-registry/tools/TeamDeleteTool/constants.js'
import { getSpinnerVerbs } from '@claude-code/agent/constants/spinnerVerbs.js'
import { TURN_COMPLETION_VERBS } from '@claude-code/agent/constants/turnCompletionVerbs.js'
import {
  createAssistantAPIErrorMessage,
  createUserMessage,
  SUBAGENT_REJECT_MESSAGE,
  SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
} from '@claude-code/agent/messages.js'
import { evictTaskOutput } from '@claude-code/storage/task/diskOutput.js'
import {
  evictTerminalTask,
  registerTask,
  STOPPED_DISPLAY_MS,
  updateTaskState,
} from '@claude-code/agent/task/framework.js'
import { tokenCountWithEstimation } from '@claude-code/agent/tokens.js'
import { createAbortController } from '@claude-code/agent/abortController.js'
import { runWithAgentContext } from '@claude-code/agent/agentContext.js'
import { count } from '@claude-code/tool-registry/utils/array.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { logError } from '@claude-code/local-observability/log.js'
import { cloneFileStateCache } from '@claude-code/tool-registry/fileStateCache'
import {
  applyPermissionUpdate,
  applyPermissionUpdates,
  persistPermissionUpdates,
} from '@claude-code/permission/PermissionUpdate'
import { hasPermissionsToUseTool } from '@claude-code/permission/permissions'
import { emitTaskTerminatedSdk } from '@claude-code/agent/sdkEventQueue.js'
import { sleep } from '@claude-code/config/sleep'
import { jsonParse, jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import { asSystemPrompt } from '@claude-code/provider/systemPromptType.js'
import {
  claimTask,
  listTasks,
  updateTask,
  sanitizePathComponent,
  getTasksDir,
  notifyTasksUpdated,
} from '@claude-code/agent/tasks.js'
import { PermissionModeSchema } from '@claude-code/headless-sdk/coreSchemas.js'
import {
  createTeammateContext,
  runWithTeammateContext,
} from '../teammateContextAlias.js'
import {
  getAgentId,
  getAgentName,
  getDynamicTeamContext,
  getTeamName,
  getTeammateColor,
  isTeammate,
} from '../teammateState.js'
import {
  isPerfettoTracingEnabled,
  registerAgent,
  unregisterAgent,
} from '@claude-code/local-observability/telemetry/perfettoTracing.js'
import { createContentReplacementState } from '@claude-code/storage/toolResultStorage.js'
import {
  formatAgentId,
  generateRequestId,
  parseAgentId,
} from '@claude-code/agent/agentIdUtils'
import { registerCleanup } from '@claude-code/app-host/bootstrap/cleanupRegistry.js'
import {
  getChromeFlagOverride,
  getFlagSettingsPath,
  getInlinePlugins,
  getIsNonInteractiveSession,
  getMainLoopModelOverride,
  getSessionBypassPermissionsMode,
  getSessionCreatedTeams,
  getSessionId,
} from '@claude-code/app-host/bootstrap/state.js'
import { quote } from '@claude-code/shell/bash/shellQuote.js'
import { isInBundledMode } from '@claude-code/config/bundledMode'
import { getPlatform } from '@claude-code/config/platform'
import {
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from '@claude-code/config'
import { env } from '@claude-code/config/env/paths'
import {
  execFileNoThrow,
  execFileNoThrowWithCwd,
} from '@claude-code/shell/execFileNoThrow.js'
import { getTeamsDir } from '@claude-code/config/env/utils'
import { errorMessage, getErrnoCode } from '@claude-code/local-observability/errorHelpers.js'
import { lazySchema } from '@claude-code/tool-registry/utils/lazySchema.js'
import { check, lock, lockSync, unlock } from '@claude-code/storage/lockfile.js'
import {
  findCanonicalGitRoot,
  findGitRoot,
  getBranch,
  getDefaultBranch,
  gitExe,
} from '@claude-code/storage/git.js'
import { parseGitConfigValue } from '@claude-code/agent/git/gitConfigParser.js'
import {
  getCommonDir,
  readWorktreeHeadSha,
  resolveGitDir,
  resolveRef,
} from '@claude-code/agent/git/gitFilesystem.js'
import {
  executeWorktreeCreateHook,
  executeWorktreeRemoveHook,
  hasWorktreeCreateHook,
} from '@claude-code/agent/hooks.js'
import { addFunctionHook } from '@claude-code/agent/hooks/sessionHooks.js'
import { containsPathTraversal } from '@claude-code/storage/path.js'
import {
  getInitialSettings,
  getRelativeSettingsFilePathForSource,
} from '@claude-code/config/settings/core/settings.js'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { CLAUDE_OPUS_4_7_CONFIG } from '@claude-code/provider/model/configs.js'
import { getAPIProvider } from '@claude-code/provider/model/providers.js'

let installed = false

export function installSwarmHost(): void {
  if (installed) {
    return
  }

  installSwarmAppRuntime({
    async getSystemPrompt(...args: any[]) {
      const mod = await import('@claude-code/agent/constants/prompts.js')
      return mod.getSystemPrompt(...args)
    },
    TEAMMATE_MESSAGE_TAG,
    processMailboxPermissionResponse,
    registerPermissionCallback,
    unregisterPermissionCallback,
    logEvent,
    getAutoCompactThreshold,
    buildPostCompactMessages,
    compactConversation,
    ERROR_MESSAGE_USER_ABORT,
    resetMicrocompactState,
    createTaskStateBase,
    generateTaskId,
    isTerminalTaskStatus,
    createActivityDescriptionResolver,
    createProgressTracker,
    getProgressUpdate,
    updateProgressFromMessage,
    runAgent,
    AGENT_COLORS,
    awaitClassifierAutoApproval,
    BASH_TOOL_NAME,
    SEND_MESSAGE_TOOL_NAME,
    TASK_CREATE_TOOL_NAME,
    TASK_GET_TOOL_NAME,
    TASK_LIST_TOOL_NAME,
    TASK_UPDATE_TOOL_NAME,
    TEAM_CREATE_TOOL_NAME,
    TEAM_DELETE_TOOL_NAME,
    getSpinnerVerbs,
    TURN_COMPLETION_VERBS,
    createAssistantAPIErrorMessage,
    createUserMessage,
    SUBAGENT_REJECT_MESSAGE,
    SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
    evictTaskOutput,
    evictTerminalTask,
    registerTask,
    STOPPED_DISPLAY_MS,
    updateTaskState,
    tokenCountWithEstimation,
    createAbortController,
    runWithAgentContext,
    count,
    logForDebugging,
    logError,
    cloneFileStateCache,
    applyPermissionUpdates,
    persistPermissionUpdates,
    applyPermissionUpdate,
    hasPermissionsToUseTool,
    emitTaskTerminatedSdk,
    sleep,
    jsonParse,
    jsonStringify,
    asSystemPrompt,
    claimTask,
    listTasks,
    updateTask,
    sanitizePathComponent,
    getTasksDir,
    notifyTasksUpdated,
    PermissionModeSchema,
    createTeammateContext,
    runWithTeammateContext,
    getAgentId,
    getAgentName,
    getDynamicTeamContext,
    getTeamName,
    getTeammateColor,
    isTeammate,
    registerPerfettoAgent: registerAgent,
    unregisterPerfettoAgent: unregisterAgent,
    isPerfettoTracingEnabled,
    registerAgent,
    unregisterAgent,
    createContentReplacementState,
    formatAgentId,
    generateRequestId,
    parseAgentId,
    registerCleanup,
    getSessionId,
    getIsNonInteractiveSession,
    getChromeFlagOverride,
    getFlagSettingsPath,
    getInlinePlugins,
    getMainLoopModelOverride,
    getSessionBypassPermissionsMode,
    getSessionCreatedTeams,
    quote,
    isInBundledMode,
    getPlatform,
    getGlobalConfig,
    saveGlobalConfig,
    env,
    execFileNoThrow,
    execFileNoThrowWithCwd,
    getTeamsDir,
    errorMessage,
    getErrnoCode,
    lazySchema,
    lock,
    lockSync,
    unlock,
    check,
    gitExe,
    parseGitConfigValue,
    getCommonDir,
    readWorktreeHeadSha,
    resolveGitDir,
    resolveRef,
    findCanonicalGitRoot,
    findGitRoot,
    getBranch,
    getDefaultBranch,
    executeWorktreeCreateHook,
    executeWorktreeRemoveHook,
    hasWorktreeCreateHook,
    addFunctionHook,
    containsPathTraversal,
    getInitialSettings,
    getRelativeSettingsFilePathForSource,
    getCwd,
    saveCurrentProjectConfig,
    CLAUDE_OPUS_4_7_CONFIG,
    getAPIProvider,
  })

  installSwarmAppUi({
    Select,
    Spinner,
    useExitOnCtrlCDWithKeybindings,
  })

  installed = true
}

installSwarmHost()

export type { OptionWithDescription }
