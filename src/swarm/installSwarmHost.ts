import { installSwarmAppRuntime } from '../../packages/swarm/src/adapters/appRuntime.js'
import { installSwarmAppUi } from '../../packages/swarm/src/adapters/appUi.js'
import { TEAMMATE_MESSAGE_TAG } from '../constants/xml.js'
import {
  processMailboxPermissionResponse,
  registerPermissionCallback,
  unregisterPermissionCallback,
} from '../hooks/useSwarmPermissionPoller.js'
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js'
import { Spinner } from '../components/Spinner.js'
import {
  type OptionWithDescription,
  Select,
} from '../components/CustomSelect/index.js'
import { logEvent } from '@claude-code/local-observability'
import { getAutoCompactThreshold } from '../services/compact/autoCompact.js'
import {
  buildPostCompactMessages,
  compactConversation,
  ERROR_MESSAGE_USER_ABORT,
} from '../services/compact/compact.js'
import { resetMicrocompactState } from '../services/compact/microCompact.js'
import {
  createTaskStateBase,
  generateTaskId,
  isTerminalTaskStatus,
} from '../Task.js'
import {
  createActivityDescriptionResolver,
  createProgressTracker,
  getProgressUpdate,
  updateProgressFromMessage,
} from '../tasks/LocalAgentTask/LocalAgentTask.js'
import { AGENT_COLORS } from '../tools/AgentTool/agentColorManager.js'
import { runAgent } from '../tools/AgentTool/runAgent.js'
import { awaitClassifierAutoApproval } from '../tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import { SEND_MESSAGE_TOOL_NAME } from '../tools/SendMessageTool/constants.js'
import { TASK_CREATE_TOOL_NAME } from '../tools/TaskCreateTool/constants.js'
import { TASK_GET_TOOL_NAME } from '../tools/TaskGetTool/constants.js'
import { TASK_LIST_TOOL_NAME } from '../tools/TaskListTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '../tools/TaskUpdateTool/constants.js'
import { TEAM_CREATE_TOOL_NAME } from '../tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '../tools/TeamDeleteTool/constants.js'
import { getSpinnerVerbs } from '../constants/spinnerVerbs.js'
import { TURN_COMPLETION_VERBS } from '../constants/turnCompletionVerbs.js'
import {
  createAssistantAPIErrorMessage,
  createUserMessage,
  SUBAGENT_REJECT_MESSAGE,
  SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
} from '../utils/messages.js'
import { evictTaskOutput } from '../utils/task/diskOutput.js'
import {
  evictTerminalTask,
  registerTask,
  STOPPED_DISPLAY_MS,
  updateTaskState,
} from '../utils/task/framework.js'
import { tokenCountWithEstimation } from '../utils/tokens.js'
import { createAbortController } from '../utils/abortController.js'
import { runWithAgentContext } from '../utils/agentContext.js'
import { count } from '../utils/array.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'
import { cloneFileStateCache } from '../utils/fileStateCache.js'
import {
  applyPermissionUpdate,
  applyPermissionUpdates,
  persistPermissionUpdates,
} from '@claude-code/permission/PermissionUpdate'
import { hasPermissionsToUseTool } from '@claude-code/permission/permissions'
import { emitTaskTerminatedSdk } from '../utils/sdkEventQueue.js'
import { sleep } from '../utils/sleep.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import {
  claimTask,
  listTasks,
  updateTask,
  sanitizePathComponent,
  getTasksDir,
  notifyTasksUpdated,
} from '../utils/tasks.js'
import { PermissionModeSchema } from '../entrypoints/sdk/coreSchemas.js'
import {
  createTeammateContext,
  runWithTeammateContext,
} from '../utils/teammateContext.js'
import {
  getAgentId,
  getAgentName,
  getDynamicTeamContext,
  getTeamName,
  getTeammateColor,
  isTeammate,
} from '../utils/teammate.js'
import {
  isPerfettoTracingEnabled,
  registerAgent,
  unregisterAgent,
} from '../utils/telemetry/perfettoTracing.js'
import { createContentReplacementState } from '../utils/toolResultStorage.js'
import {
  formatAgentId,
  generateRequestId,
  parseAgentId,
} from '../utils/agentId.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import {
  getChromeFlagOverride,
  getFlagSettingsPath,
  getInlinePlugins,
  getIsNonInteractiveSession,
  getMainLoopModelOverride,
  getSessionBypassPermissionsMode,
  getSessionCreatedTeams,
  getSessionId,
} from '../bootstrap/state.js'
import { quote } from '../utils/bash/shellQuote.js'
import { isInBundledMode } from '../utils/bundledMode.js'
import { getPlatform } from '../utils/platform.js'
import {
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from '@claude-code/config'
import { env } from '../utils/env.js'
import {
  execFileNoThrow,
  execFileNoThrowWithCwd,
} from '../utils/execFileNoThrow.js'
import { getTeamsDir } from '../utils/envUtils.js'
import { errorMessage, getErrnoCode } from '../utils/errors.js'
import { lazySchema } from '../utils/lazySchema.js'
import { check, lock, lockSync, unlock } from '../utils/lockfile.js'
import {
  findCanonicalGitRoot,
  findGitRoot,
  getBranch,
  getDefaultBranch,
  gitExe,
} from '../utils/git.js'
import { parseGitConfigValue } from '../utils/git/gitConfigParser.js'
import {
  getCommonDir,
  readWorktreeHeadSha,
  resolveGitDir,
  resolveRef,
} from '../utils/git/gitFilesystem.js'
import {
  executeWorktreeCreateHook,
  executeWorktreeRemoveHook,
  hasWorktreeCreateHook,
} from '../utils/hooks.js'
import { addFunctionHook } from '../utils/hooks/sessionHooks.js'
import { containsPathTraversal } from '../utils/path.js'
import {
  getInitialSettings,
  getRelativeSettingsFilePathForSource,
} from '../utils/settings/settings.js'
import { getCwd } from '../utils/cwd.js'
import { CLAUDE_OPUS_4_6_CONFIG } from '../utils/model/configs.js'
import { getAPIProvider } from '../utils/model/providers.js'

let installed = false

export function installSwarmHost(): void {
  if (installed) {
    return
  }

  installSwarmAppRuntime({
    async getSystemPrompt(...args: any[]) {
      const mod = await import('../constants/prompts.js')
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
    CLAUDE_OPUS_4_6_CONFIG,
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
