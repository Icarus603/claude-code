export type {
  SwarmHostDeps,
  HostApiProvider,
  HostToolRegistry,
  HostPermissionGate,
  HostCompaction,
  HostContextProvider,
  HostSessionManager,
  HostEventSink,
  HostHookCallbacks,
  HostFileSystem,
  HostTerminalBackend,
  TerminalEnvironment,
  PaneCreateOptions,
  PaneHandle,
  HostTaskSystem,
  HostTask,
  HostUIState,
  HostWorktreeManager,
  HostEnvironment,
} from './types/deps.js'

export type {
  BackendType,
  PaneBackendType,
  PaneId,
  CreatePaneResult,
  PaneBackend,
  BackendDetectionResult,
  TeammateSpawnConfig as BackendTeammateSpawnConfig,
  TeammateSpawnResult as BackendTeammateSpawnResult,
  TeammateMessage as BackendTeammateMessage,
  TeammateExecutor,
} from './backends/types.js'

export { isPaneBackend } from './backends/types.js'

export {
  TEAM_LEAD_NAME,
  MAILBOX_POLL_INTERVAL_MS,
  PERMISSION_POLL_INTERVAL_MS,
  TEAMMATE_MESSAGES_UI_CAP,
  LOCK_OPTIONS,
  ENV,
} from './types/constants.js'

export {
  SWARM_SESSION_NAME,
  SWARM_VIEW_WINDOW_NAME,
  TMUX_COMMAND,
  HIDDEN_SESSION_NAME,
  getSwarmSocketName,
  TEAMMATE_COMMAND_ENV_VAR,
  TEAMMATE_COLOR_ENV_VAR,
  PLAN_MODE_REQUIRED_ENV_VAR,
} from './core/constants.js'

export { TEAMMATE_SYSTEM_PROMPT_ADDENDUM } from './core/teammatePromptAddendum.js'
export { It2SetupPrompt } from './core/It2SetupPrompt.js'

export {
  sanitizeName,
  sanitizeAgentName,
  getTeamDir,
  getTeamFilePath,
  readTeamFile,
  readTeamFileAsync,
  writeTeamFileAsync,
  removeTeammateFromTeamFile,
  addHiddenPaneId,
  removeHiddenPaneId,
  removeMemberFromTeam,
  removeMemberByAgentId,
  setMemberMode,
  syncTeammateMode,
  setMultipleMemberModes,
  setMemberActive,
  registerTeamForSessionCleanup,
  unregisterTeamForSessionCleanup,
  cleanupSessionTeams,
  cleanupTeamDirectories,
  inputSchema,
} from './core/teamHelpers.js'

export type {
  SpawnTeamOutput,
  CleanupOutput,
  TeamAllowedPath,
  TeamFile,
  Input as TeamHelpersInput,
  Output as TeamHelpersOutput,
} from './core/teamHelpers.js'

export {
  computeInitialTeamContext,
  initializeTeammateContextFromSession,
} from './core/reconnection.js'

export { initializeTeammateHooks } from './core/teammateInit.js'

export {
  assignTeammateColor,
  getTeammateColor,
  clearTeammateColors,
  isInsideTmux as isInsideTmuxFromLayoutManager,
  createTeammatePaneInSwarmView,
  enablePaneBorderStatus,
  sendCommandToPane,
} from './core/teammateLayoutManager.js'

export { getHardcodedTeammateModelFallback } from './core/teammateModel.js'

export * from './mailbox/index.js'
export * from './permissions/index.js'
export * from './permissions/leaderPermissionBridge.js'

export {
  isInsideTmuxSync,
  isInsideTmux,
  getLeaderPaneId,
  isTmuxAvailable,
  isInITerm2,
  IT2_COMMAND,
  isIt2CliAvailable,
  resetDetectionCache,
} from './backends/detection.js'

export type { TeammateMode } from './backends/teammateModeSnapshot.js'
export {
  setCliTeammateModeOverride,
  getCliTeammateModeOverride,
  clearCliTeammateModeOverride,
  captureTeammateModeSnapshot,
  getTeammateModeFromSnapshot,
} from './backends/teammateModeSnapshot.js'

export {
  ensureBackendsRegistered,
  registerTmuxBackend,
  registerITermBackend,
  detectAndGetBackend,
  getBackendByType,
  getCachedBackend,
  getCachedDetectionResult,
  markInProcessFallback,
  isInProcessEnabled,
  getResolvedTeammateMode,
  getInProcessBackend,
  getTeammateExecutor,
  resetBackendDetection,
} from './backends/registry.js'

export { ITermBackend } from './backends/ITermBackend.js'
export { TmuxBackend } from './backends/TmuxBackend.js'
export {
  InProcessBackend,
  createInProcessBackend,
} from './backends/InProcessBackend.js'
export {
  PaneBackendExecutor,
  createPaneBackendExecutor,
} from './backends/PaneBackendExecutor.js'

export {
  getTeammateCommand,
  buildInheritedCliFlags,
  buildInheritedEnvVars,
} from './runtime/spawnUtils.js'

export type {
  SpawnContext,
  InProcessSpawnConfig,
  InProcessSpawnOutput,
} from './runtime/spawnInProcess.js'

export {
  spawnInProcessTeammate,
  killInProcessTeammate,
} from './runtime/spawnInProcess.js'

export type {
  InProcessRunnerConfig,
  InProcessRunnerResult,
} from './runtime/inProcessRunner.js'

export {
  runInProcessTeammate,
  startInProcessTeammate,
} from './runtime/inProcessRunner.js'

export type {
  TeammateIdentity as TaskTeammateIdentity,
  InProcessTeammateTaskState,
} from './tasks/types.js'

export {
  isInProcessTeammateTask,
  appendCappedMessage,
} from './tasks/types.js'

export {
  InProcessTeammateTask,
  requestTeammateShutdown,
  appendTeammateMessage,
  injectUserMessageToTeammate,
  findTeammateTaskByAgentId,
  getAllInProcessTeammateTasks,
  getRunningTeammatesSorted,
} from './tasks/InProcessTeammateTask.js'

export * from './worktree/index.js'

export {
  buildSwarmAgentDeps,
  createSwarmMailboxAdapter,
  createSwarmTaskClaimingAdapter,
} from './adapters/buildSwarmAgentDeps.js'
export { createSwarmHostDeps } from './adapters/createSwarmHostDeps.js'
