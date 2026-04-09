import { z } from 'zod'

type RuntimeBindingMap = Record<string, any>

let runtimeBindings: RuntimeBindingMap | null = null

function missingBinding(name: string): (...args: any[]) => never {
  return (..._args: any[]) => {
    throw new Error(
      `Swarm runtime binding "${name}" was accessed before installSwarmAppRuntime()`,
    )
  }
}

function getBinding<T>(name: string): T {
  if (!runtimeBindings || !(name in runtimeBindings)) {
    throw new Error(
      `Swarm runtime binding "${name}" is unavailable. installSwarmAppRuntime() must run before using @claude-code/swarm runtime helpers.`,
    )
  }
  return runtimeBindings[name] as T
}

function bindFunction<T extends (...args: any[]) => any>(name: string): T {
  return getBinding<T>(name)
}

function bindValue<T>(name: string): T {
  return getBinding<T>(name)
}

export type CanUseToolFn = (...args: any[]) => Promise<any>
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = string
export type AppState = unknown;
export type Tool = unknown;
export type ToolUseContext = unknown;
export type AgentProgress = unknown;
export type CustomAgentDefinition = unknown;
export type AgentDefinition = unknown;
export type AgentToolResult = unknown;
export type Message = unknown;
export type PermissionDecision = unknown;
export type AgentContext = unknown;
export type ModelAlias = string
export type PermissionUpdate = unknown;
export type PermissionMode = string
export type Task = unknown;
export type TeammateContext = unknown;
export type AgentColorName = string

export let TEAMMATE_MESSAGE_TAG = 'teammate-message'
export let ERROR_MESSAGE_USER_ABORT = ''
export let BASH_TOOL_NAME = ''
export let SEND_MESSAGE_TOOL_NAME = ''
export let TASK_CREATE_TOOL_NAME = ''
export let TASK_GET_TOOL_NAME = ''
export let TASK_LIST_TOOL_NAME = ''
export let TASK_UPDATE_TOOL_NAME = ''
export let TEAM_CREATE_TOOL_NAME = ''
export let TEAM_DELETE_TOOL_NAME = ''
export let TURN_COMPLETION_VERBS: string[] = []
export let SUBAGENT_REJECT_MESSAGE = ''
export let SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX = ''
export let STOPPED_DISPLAY_MS = 0
export let AGENT_COLORS: string[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'cyan',
]
export let CLAUDE_OPUS_4_6_CONFIG: { name: string } = { name: '' }
export let env: any = {}

export let getSystemPrompt = missingBinding('getSystemPrompt') as any
export let processMailboxPermissionResponse = missingBinding(
  'processMailboxPermissionResponse',
) as any
export let registerPermissionCallback = missingBinding(
  'registerPermissionCallback',
) as any
export let unregisterPermissionCallback = missingBinding(
  'unregisterPermissionCallback',
) as any
export let logEvent = missingBinding('logEvent') as any
export let getAutoCompactThreshold = missingBinding(
  'getAutoCompactThreshold',
) as any
export let buildPostCompactMessages = missingBinding(
  'buildPostCompactMessages',
) as any
export let compactConversation = missingBinding('compactConversation') as any
export let resetMicrocompactState = missingBinding(
  'resetMicrocompactState',
) as any
export let createTaskStateBase = missingBinding('createTaskStateBase') as any
export let generateTaskId = missingBinding('generateTaskId') as any
export let isTerminalTaskStatus = missingBinding(
  'isTerminalTaskStatus',
) as any
export let createActivityDescriptionResolver = missingBinding(
  'createActivityDescriptionResolver',
) as any
export let createProgressTracker = missingBinding(
  'createProgressTracker',
) as any
export let getProgressUpdate = missingBinding('getProgressUpdate') as any
export let updateProgressFromMessage = missingBinding(
  'updateProgressFromMessage',
) as any
export let runAgent = missingBinding('runAgent') as any
export let awaitClassifierAutoApproval = missingBinding(
  'awaitClassifierAutoApproval',
) as any
export let getSpinnerVerbs = missingBinding('getSpinnerVerbs') as any
export let createAssistantAPIErrorMessage = missingBinding(
  'createAssistantAPIErrorMessage',
) as any
export let createUserMessage = missingBinding('createUserMessage') as any
export let evictTaskOutput = missingBinding('evictTaskOutput') as any
export let evictTerminalTask = missingBinding('evictTerminalTask') as any
export let registerTask = missingBinding('registerTask') as any
export let updateTaskState = missingBinding('updateTaskState') as any
export let tokenCountWithEstimation = missingBinding(
  'tokenCountWithEstimation',
) as any
export let createAbortController = missingBinding(
  'createAbortController',
) as any
export let runWithAgentContext = missingBinding('runWithAgentContext') as any
export let count = missingBinding('count') as any
export let logForDebugging = (() => {}) as any
export let logError = (() => {}) as any
export let cloneFileStateCache = missingBinding(
  'cloneFileStateCache',
) as any
export let applyPermissionUpdates = missingBinding(
  'applyPermissionUpdates',
) as any
export let persistPermissionUpdates = missingBinding(
  'persistPermissionUpdates',
) as any
export let applyPermissionUpdate = missingBinding(
  'applyPermissionUpdate',
) as any
export let hasPermissionsToUseTool = missingBinding(
  'hasPermissionsToUseTool',
) as any
export let emitTaskTerminatedSdk = missingBinding(
  'emitTaskTerminatedSdk',
) as any
export let sleep = missingBinding('sleep') as any
export let jsonParse = missingBinding('jsonParse') as any
export let jsonStringify = missingBinding('jsonStringify') as any
export let asSystemPrompt = missingBinding('asSystemPrompt') as any
export let claimTask = missingBinding('claimTask') as any
export let listTasks = missingBinding('listTasks') as any
export let updateTask = missingBinding('updateTask') as any
export let sanitizePathComponent = missingBinding(
  'sanitizePathComponent',
) as any
export let getTasksDir = missingBinding('getTasksDir') as any
export let notifyTasksUpdated = missingBinding('notifyTasksUpdated') as any
export const PermissionModeSchema = lazySchema(() =>
  z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']),
)
export let createTeammateContext = missingBinding(
  'createTeammateContext',
) as any
export let runWithTeammateContext = missingBinding(
  'runWithTeammateContext',
) as any
export let getAgentId = missingBinding('getAgentId') as any
export let getAgentName = missingBinding('getAgentName') as any
export let getDynamicTeamContext = missingBinding(
  'getDynamicTeamContext',
) as any
export let getTeamName = missingBinding('getTeamName') as any
export let getTeammateColor = missingBinding('getTeammateColor') as any
export let isTeammate = missingBinding('isTeammate') as any
export let registerPerfettoAgent = missingBinding(
  'registerPerfettoAgent',
) as any
export let unregisterPerfettoAgent = missingBinding(
  'unregisterPerfettoAgent',
) as any
export let isPerfettoTracingEnabled = missingBinding(
  'isPerfettoTracingEnabled',
) as any
export let registerAgent = missingBinding('registerAgent') as any
export let unregisterAgent = missingBinding('unregisterAgent') as any
export let createContentReplacementState = missingBinding(
  'createContentReplacementState',
) as any
export let formatAgentId = missingBinding('formatAgentId') as any
export let generateRequestId = missingBinding('generateRequestId') as any
export let parseAgentId = missingBinding('parseAgentId') as any
export let registerCleanup = missingBinding('registerCleanup') as any
export let getSessionId = missingBinding('getSessionId') as any
export let getIsNonInteractiveSession = missingBinding(
  'getIsNonInteractiveSession',
) as any
export let getChromeFlagOverride = missingBinding(
  'getChromeFlagOverride',
) as any
export let getFlagSettingsPath = missingBinding('getFlagSettingsPath') as any
export let getInlinePlugins = missingBinding('getInlinePlugins') as any
export let getMainLoopModelOverride = missingBinding(
  'getMainLoopModelOverride',
) as any
export let getSessionBypassPermissionsMode = missingBinding(
  'getSessionBypassPermissionsMode',
) as any
export let getSessionCreatedTeams = missingBinding(
  'getSessionCreatedTeams',
) as any
export let quote = missingBinding('quote') as any
export let isInBundledMode = missingBinding('isInBundledMode') as any
export let getPlatform = missingBinding('getPlatform') as any
export let getGlobalConfig = missingBinding('getGlobalConfig') as any
export let saveGlobalConfig = missingBinding('saveGlobalConfig') as any
export let execFileNoThrow = missingBinding('execFileNoThrow') as any
export let execFileNoThrowWithCwd = missingBinding(
  'execFileNoThrowWithCwd',
) as any
export let getTeamsDir = missingBinding('getTeamsDir') as any
export let errorMessage = missingBinding('errorMessage') as any
export let getErrnoCode = missingBinding('getErrnoCode') as any
export function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}
export let lock = missingBinding('lock') as any
export let lockSync = missingBinding('lockSync') as any
export let unlock = missingBinding('unlock') as any
export let check = missingBinding('check') as any
export let gitExe = missingBinding('gitExe') as any
export let parseGitConfigValue = missingBinding('parseGitConfigValue') as any
export let getCommonDir = missingBinding('getCommonDir') as any
export let readWorktreeHeadSha = missingBinding('readWorktreeHeadSha') as any
export let resolveGitDir = missingBinding('resolveGitDir') as any
export let resolveRef = missingBinding('resolveRef') as any
export let findCanonicalGitRoot = missingBinding(
  'findCanonicalGitRoot',
) as any
export let findGitRoot = missingBinding('findGitRoot') as any
export let getBranch = missingBinding('getBranch') as any
export let getDefaultBranch = missingBinding('getDefaultBranch') as any
export let executeWorktreeCreateHook = missingBinding(
  'executeWorktreeCreateHook',
) as any
export let executeWorktreeRemoveHook = missingBinding(
  'executeWorktreeRemoveHook',
) as any
export let hasWorktreeCreateHook = missingBinding(
  'hasWorktreeCreateHook',
) as any
export let addFunctionHook = missingBinding('addFunctionHook') as any
export let containsPathTraversal = missingBinding(
  'containsPathTraversal',
) as any
export let getInitialSettings = missingBinding('getInitialSettings') as any
export let getRelativeSettingsFilePathForSource = missingBinding(
  'getRelativeSettingsFilePathForSource',
) as any
export let getCwd = missingBinding('getCwd') as any
export let saveCurrentProjectConfig = missingBinding(
  'saveCurrentProjectConfig',
) as any
export let getAPIProvider = missingBinding('getAPIProvider') as any

export function installSwarmAppRuntime(bindings: RuntimeBindingMap): void {
  runtimeBindings = bindings

  TEAMMATE_MESSAGE_TAG = bindValue('TEAMMATE_MESSAGE_TAG')
  ERROR_MESSAGE_USER_ABORT = bindValue('ERROR_MESSAGE_USER_ABORT')
  BASH_TOOL_NAME = bindValue('BASH_TOOL_NAME')
  SEND_MESSAGE_TOOL_NAME = bindValue('SEND_MESSAGE_TOOL_NAME')
  TASK_CREATE_TOOL_NAME = bindValue('TASK_CREATE_TOOL_NAME')
  TASK_GET_TOOL_NAME = bindValue('TASK_GET_TOOL_NAME')
  TASK_LIST_TOOL_NAME = bindValue('TASK_LIST_TOOL_NAME')
  TASK_UPDATE_TOOL_NAME = bindValue('TASK_UPDATE_TOOL_NAME')
  TEAM_CREATE_TOOL_NAME = bindValue('TEAM_CREATE_TOOL_NAME')
  TEAM_DELETE_TOOL_NAME = bindValue('TEAM_DELETE_TOOL_NAME')
  TURN_COMPLETION_VERBS = bindValue('TURN_COMPLETION_VERBS')
  SUBAGENT_REJECT_MESSAGE = bindValue('SUBAGENT_REJECT_MESSAGE')
  SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX = bindValue(
    'SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX',
  )
  STOPPED_DISPLAY_MS = bindValue('STOPPED_DISPLAY_MS')
  AGENT_COLORS = bindValue('AGENT_COLORS')
  CLAUDE_OPUS_4_6_CONFIG = bindValue('CLAUDE_OPUS_4_6_CONFIG')
  env = bindValue('env')

  getSystemPrompt = bindFunction('getSystemPrompt')
  processMailboxPermissionResponse = bindFunction(
    'processMailboxPermissionResponse',
  )
  registerPermissionCallback = bindFunction('registerPermissionCallback')
  unregisterPermissionCallback = bindFunction('unregisterPermissionCallback')
  logEvent = bindFunction('logEvent')
  getAutoCompactThreshold = bindFunction('getAutoCompactThreshold')
  buildPostCompactMessages = bindFunction('buildPostCompactMessages')
  compactConversation = bindFunction('compactConversation')
  resetMicrocompactState = bindFunction('resetMicrocompactState')
  createTaskStateBase = bindFunction('createTaskStateBase')
  generateTaskId = bindFunction('generateTaskId')
  isTerminalTaskStatus = bindFunction('isTerminalTaskStatus')
  createActivityDescriptionResolver = bindFunction(
    'createActivityDescriptionResolver',
  )
  createProgressTracker = bindFunction('createProgressTracker')
  getProgressUpdate = bindFunction('getProgressUpdate')
  updateProgressFromMessage = bindFunction('updateProgressFromMessage')
  runAgent = bindFunction('runAgent')
  awaitClassifierAutoApproval = bindFunction('awaitClassifierAutoApproval')
  getSpinnerVerbs = bindFunction('getSpinnerVerbs')
  createAssistantAPIErrorMessage = bindFunction(
    'createAssistantAPIErrorMessage',
  )
  createUserMessage = bindFunction('createUserMessage')
  evictTaskOutput = bindFunction('evictTaskOutput')
  evictTerminalTask = bindFunction('evictTerminalTask')
  registerTask = bindFunction('registerTask')
  updateTaskState = bindFunction('updateTaskState')
  tokenCountWithEstimation = bindFunction('tokenCountWithEstimation')
  createAbortController = bindFunction('createAbortController')
  runWithAgentContext = bindFunction('runWithAgentContext')
  count = bindFunction('count')
  logForDebugging = bindFunction('logForDebugging')
  logError = bindFunction('logError')
  cloneFileStateCache = bindFunction('cloneFileStateCache')
  applyPermissionUpdates = bindFunction('applyPermissionUpdates')
  persistPermissionUpdates = bindFunction('persistPermissionUpdates')
  applyPermissionUpdate = bindFunction('applyPermissionUpdate')
  hasPermissionsToUseTool = bindFunction('hasPermissionsToUseTool')
  emitTaskTerminatedSdk = bindFunction('emitTaskTerminatedSdk')
  sleep = bindFunction('sleep')
  jsonParse = bindFunction('jsonParse')
  jsonStringify = bindFunction('jsonStringify')
  asSystemPrompt = bindFunction('asSystemPrompt')
  claimTask = bindFunction('claimTask')
  listTasks = bindFunction('listTasks')
  updateTask = bindFunction('updateTask')
  sanitizePathComponent = bindFunction('sanitizePathComponent')
  getTasksDir = bindFunction('getTasksDir')
  notifyTasksUpdated = bindFunction('notifyTasksUpdated')
  createTeammateContext = bindFunction('createTeammateContext')
  runWithTeammateContext = bindFunction('runWithTeammateContext')
  getAgentId = bindFunction('getAgentId')
  getAgentName = bindFunction('getAgentName')
  getDynamicTeamContext = bindFunction('getDynamicTeamContext')
  getTeamName = bindFunction('getTeamName')
  getTeammateColor = bindFunction('getTeammateColor')
  isTeammate = bindFunction('isTeammate')
  registerPerfettoAgent = bindFunction('registerPerfettoAgent')
  unregisterPerfettoAgent = bindFunction('unregisterPerfettoAgent')
  isPerfettoTracingEnabled = bindFunction('isPerfettoTracingEnabled')
  registerAgent = bindFunction('registerAgent')
  unregisterAgent = bindFunction('unregisterAgent')
  createContentReplacementState = bindFunction('createContentReplacementState')
  formatAgentId = bindFunction('formatAgentId')
  generateRequestId = bindFunction('generateRequestId')
  parseAgentId = bindFunction('parseAgentId')
  registerCleanup = bindFunction('registerCleanup')
  getSessionId = bindFunction('getSessionId')
  getIsNonInteractiveSession = bindFunction('getIsNonInteractiveSession')
  getChromeFlagOverride = bindFunction('getChromeFlagOverride')
  getFlagSettingsPath = bindFunction('getFlagSettingsPath')
  getInlinePlugins = bindFunction('getInlinePlugins')
  getMainLoopModelOverride = bindFunction('getMainLoopModelOverride')
  getSessionBypassPermissionsMode = bindFunction(
    'getSessionBypassPermissionsMode',
  )
  getSessionCreatedTeams = bindFunction('getSessionCreatedTeams')
  quote = bindFunction('quote')
  isInBundledMode = bindFunction('isInBundledMode')
  getPlatform = bindFunction('getPlatform')
  getGlobalConfig = bindFunction('getGlobalConfig')
  saveGlobalConfig = bindFunction('saveGlobalConfig')
  execFileNoThrow = bindFunction('execFileNoThrow')
  execFileNoThrowWithCwd = bindFunction('execFileNoThrowWithCwd')
  getTeamsDir = bindFunction('getTeamsDir')
  errorMessage = bindFunction('errorMessage')
  getErrnoCode = bindFunction('getErrnoCode')
  lock = bindFunction('lock')
  lockSync = bindFunction('lockSync')
  unlock = bindFunction('unlock')
  check = bindFunction('check')
  gitExe = bindFunction('gitExe')
  parseGitConfigValue = bindFunction('parseGitConfigValue')
  getCommonDir = bindFunction('getCommonDir')
  readWorktreeHeadSha = bindFunction('readWorktreeHeadSha')
  resolveGitDir = bindFunction('resolveGitDir')
  resolveRef = bindFunction('resolveRef')
  findCanonicalGitRoot = bindFunction('findCanonicalGitRoot')
  findGitRoot = bindFunction('findGitRoot')
  getBranch = bindFunction('getBranch')
  getDefaultBranch = bindFunction('getDefaultBranch')
  executeWorktreeCreateHook = bindFunction('executeWorktreeCreateHook')
  executeWorktreeRemoveHook = bindFunction('executeWorktreeRemoveHook')
  hasWorktreeCreateHook = bindFunction('hasWorktreeCreateHook')
  addFunctionHook = bindFunction('addFunctionHook')
  containsPathTraversal = bindFunction('containsPathTraversal')
  getInitialSettings = bindFunction('getInitialSettings')
  getRelativeSettingsFilePathForSource = bindFunction(
    'getRelativeSettingsFilePathForSource',
  )
  getCwd = bindFunction('getCwd')
  saveCurrentProjectConfig = bindFunction('saveCurrentProjectConfig')
  getAPIProvider = bindFunction('getAPIProvider')
}
