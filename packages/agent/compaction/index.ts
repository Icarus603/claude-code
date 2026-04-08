
export type {
  CompactionResult,
  CompactionTrigger,
  CompactionContext,
  TokenWarningState,
  SnipCompactResult,
  MicrocompactResult,
  CachedMCConfig,
  TimeBasedMCConfig,
  ContextEditStrategy,
  ContextManagementConfig,
  PostCompactCleanupActions,
  ToolNameConstants,
  SessionMemoryCompactConfig,
} from '../types/compaction.js'

export type {
  CompactionDeps,
  FeatureFlagDep,
  ConfigDep,
  ModelDep,
  TokenDep,
  AnalyticsDep,
  ApiDep,
  MessagesDep,
  AttachmentsDep,
  HooksDep,
  StateDep,
  SessionMemoryDep,
  SessionStorageDep,
  PlansDep,
  SkillsDep,
  ToolSearchDep,
  ForkDep,
  ActivityDep,
  TranscriptDep,
  ContextCleanupDep,
} from '../types/compaction-deps.js'

export { groupMessagesByApiRound } from './grouping.js'
export { isSnipBoundaryMessage, projectSnippedView } from './snipProjection.js'
export {
  getCompactPrompt,
  getPartialCompactPrompt,
  getCompactUserSummaryMessage,
  formatCompactSummary,
} from './prompt.js'
export { estimateMessageTokens } from './estimateTokens.js'

export {
  SNIP_MARKER_SUBTYPE,
  SNIP_BOUNDARY_SUBTYPE,
  SNIP_NUDGE_TEXT,
  MIN_KEEP_GROUPS,
  isSnipMarkerMessage,
  createSnipBoundaryMessage,
  snipCompactCore,
  shouldNudgeForSnips,
} from './snipCompactCore.js'
export type {
  SnipMessage,
  SnipCompactDeps,
  SnipCompactResult as SnipCoreResult,
} from './snipCompactCore.js'
export { collectCompactableToolIds } from './microCompactUtils.js'
export {
  DEFAULT_SM_COMPACT_CONFIG,
  hasTextBlocks,
  adjustIndexToPreserveAPIInvariants,
  calculateMessagesToKeepIndex,
} from './sessionMemoryCalc.js'
export type { SMMessage, SessionMemoryCalcDeps } from './sessionMemoryCalc.js'

export {
  DEFAULT_CACHED_MC_CONFIG,
  getCachedMCConfig,
} from './cachedMCConfig.js'
export type { CachedMCConfigDeps } from './cachedMCConfig.js'

export {
  TIME_BASED_MC_CONFIG_DEFAULTS,
  getTimeBasedMCConfig,
} from './timeBasedMCConfig.js'
export type { TimeBasedMCConfigDeps } from './timeBasedMCConfig.js'

export {
  createCachedMCState,
  resetCachedMCState,
  markToolsSentToAPI,
  registerToolResult,
  registerToolMessage,
  getToolResultsToDelete,
  createCacheEditsBlock,
  isCachedMicrocompactEnabled,
  isModelSupportedForCacheEditing,
  getCachedMCSimpleConfig,
} from './cachedMicrocompact.js'
export type {
  CachedMCState,
  CacheEditsBlock,
  PinnedCacheEdits,
} from './cachedMicrocompact.js'

export { getAPIContextManagement } from './apiMicrocompact.js'
export type { ApiMicrocompactDeps } from './apiMicrocompact.js'

export {
  compactWarningStore,
  suppressCompactWarning,
  clearCompactWarningSuppression,
} from './compactWarningState.js'

export {
  stripImagesFromMessages,
  buildPostCompactMessages,
  annotateBoundaryWithPreservedSegment,
  mergeHookInstructions,
  isCompactBoundaryMessage,
  truncateHeadForPTLRetry,
  POST_COMPACT_MAX_FILES_TO_RESTORE,
  POST_COMPACT_TOKEN_BUDGET,
  POST_COMPACT_MAX_TOKENS_PER_FILE,
  POST_COMPACT_MAX_TOKENS_PER_SKILL,
  POST_COMPACT_SKILLS_TOKEN_BUDGET,
  MAX_COMPACT_STREAMING_RETRIES,
  ERROR_MESSAGE_NOT_ENOUGH_MESSAGES,
  ERROR_MESSAGE_PROMPT_TOO_LONG,
  ERROR_MESSAGE_USER_ABORT,
  ERROR_MESSAGE_INCOMPLETE_RESPONSE,
} from './compactUtils.js'
export type {
  CompactableMessage,
  CompactBoundaryMessage,
  CompactionResult as CompactUtilsResult,
  RecompactionInfo,
} from './compactUtils.js'

export {
  getEffectiveContextWindowSize,
  getAutoCompactThreshold,
  calculateTokenWarningState,
  isMainThreadSource,
  AUTOCOMPACT_BUFFER_TOKENS,
  WARNING_THRESHOLD_BUFFER_TOKENS,
  ERROR_THRESHOLD_BUFFER_TOKENS,
  MANUAL_COMPACT_BUFFER_TOKENS,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
} from './contextWindowManager.js'
export type { ContextWindowDeps } from './contextWindowManager.js'
