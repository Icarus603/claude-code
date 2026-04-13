export type { ConfigHostBindings } from './contracts.js'
export { installConfigHostBindings, getConfigHostBindings } from './host.js'

// V7 §7 — config owns the allowed-setting-sources state.
// Consumers in src/bootstrap/state.ts import via the dedicated
// /allowedSourcesState subpath to avoid pulling in the full config tree
// during early module init. Re-exported here so package consumers can
// also reach it via the main barrel without thinking about subpaths.
export {
  getAllowedSettingSources,
  setAllowedSettingSources,
} from './internal/allowedSourcesState.js'

// @anthropic/config — Configuration Management Package
// Phase 1: Re-export from existing src/ locations
// Phase 2: Unified interfaces (SettingsManager, FeatureFlagProvider)

// --- Phase 2: Unified interfaces ---
export { SettingsManager } from './manager.js'
export {
  FeatureFlagProvider,
  initializeGrowthBook,
  getFeatureValue_DEPRECATED,
  getFeatureValue_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_WITH_REFRESH,
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  checkSecurityRestrictionGate,
  checkGate_CACHED_OR_BLOCKING,
  refreshGrowthBookAfterAuthChange,
  resetGrowthBook,
  refreshGrowthBookFeatures,
  setupPeriodicGrowthBookRefresh,
  stopPeriodicGrowthBookRefresh,
  getDynamicConfig_BLOCKS_ON_INIT,
  getDynamicConfig_CACHED_MAY_BE_STALE,
  onGrowthBookRefresh,
  hasGrowthBookEnvOverride,
  getAllGrowthBookFeatures,
  getGrowthBookConfigOverrides,
  setGrowthBookConfigOverride,
  clearGrowthBookConfigOverrides,
} from './feature-flags.js'

// --- GlobalConfig ---
export {
  type GlobalConfig,
  type ProjectConfig,
  type HistoryEntry,
  type ReleaseChannel,
  type NotificationChannel,
  type AccountInfo,
  type EditorMode,
  type DiffTool,
  type OutputStyle,
  type PastedContent,
  type InstallMethod,
  DEFAULT_GLOBAL_CONFIG,
  GLOBAL_CONFIG_KEYS,
  PROJECT_CONFIG_KEYS,
  CONFIG_WRITE_DISPLAY_THRESHOLD,
  getGlobalConfig,
  saveGlobalConfig,
  getGlobalConfigWriteCount,
  isGlobalConfigKey,
  isProjectConfigKey,
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
  getProjectPathForConfig,
  checkHasTrustDialogAccepted,
  isPathTrusted,
  resetTrustDialogAcceptedCacheForTesting,
  enableConfigs,
  getOrCreateUserID,
  recordFirstStartTime,
  getMemoryPath,
  getManagedClaudeRulesDir,
  getUserClaudeRulesDir,
  isAutoUpdaterDisabled,
  shouldSkipPluginAutoupdate,
  getAutoUpdaterDisabledReason,
  formatAutoUpdaterDisabledReason,
  getRemoteControlAtStartup,
  getCustomApiKeyStatus,
  _getConfigForTesting,
  _wouldLoseAuthStateForTesting,
  _setGlobalConfigCacheForTesting,
} from './global/config.js'

// --- Config constants ---
export {
  NOTIFICATION_CHANNELS,
  EDITOR_MODES,
  TEAMMATE_MODES,
} from './global/constants.js'

// --- Settings types ---
export * from './settings/types.js'
export { SettingsSchema } from './settings/types.js'

// --- Settings core ---
export {
  getInitialSettings,
  getSettingsForSource,
  getSettingsWithSources,
  getSettingsWithErrors,
  getSettingsFilePathForSource,
  getRelativeSettingsFilePathForSource,
  getSettingsRootPathForSource,
  updateSettingsForSource,
  parseSettingsFile,
  loadManagedFileSettings,
  getManagedFileSettingsPresence,
  settingsMergeCustomizer,
  getManagedSettingsKeysForLogging,
  hasSkipDangerousModePermissionPrompt,
  hasAutoModeOptIn,
  getUseAutoModeDuringPlan,
  getAutoModeConfig,
  rawSettingsContainsKey,
  getSettings_DEPRECATED,
  getPolicySettingsOrigin,
} from './settings/settings.js'

// --- Settings apply change ---
export {
  applySettingsChange,
} from './settings/applySettingsChange.js'

// --- Settings managed path ---
export {
  getManagedFilePath,
  getManagedSettingsDropInDir,
} from './settings/managedPath.js'

// --- Settings plugin-only policy ---
export {
  isRestrictedToPluginOnly,
  isSourceAdminTrusted,
} from './settings/pluginOnlyPolicy.js'

// --- Settings all errors ---
export {
  getSettingsWithAllErrors,
} from './settings/allErrors.js'

// --- Settings validate edit tool ---
export {
  validateInputForSettingsFileEdit,
} from './settings/validateEditTool.js'

// --- Settings MDM ---
export {
  startMdmRawRead,
} from './settings/mdm/rawRead.js'

export {
  ensureMdmSettingsLoaded,
} from './settings/mdm/settings.js'

// --- Settings constants ---
export {
  SETTING_SOURCES,
  getEnabledSettingSources,
  getSettingSourceName,
  getSourceDisplayName,
  getSettingSourceDisplayNameLowercase,
  getSettingSourceDisplayNameCapitalized,
  parseSettingSourcesFlag,
  isSettingSourceEnabled,
  SOURCES,
  type SettingSource,
  type EditableSettingSource,
} from './settings/constants.js'

// --- Settings validation ---
export {
  filterInvalidPermissionRules,
  formatZodError,
  validateSettingsFileContent,
  type SettingsWithErrors,
  type ValidationError,
  type FieldPath,
} from './settings/validation.js'

// --- Settings schema output ---
export {
  generateSettingsJSONSchema,
} from './settings/schemaOutput.js'

// --- Settings cache ---
export {
  resetSettingsCache,
  getSessionSettingsCache,
  setSessionSettingsCache,
  getPluginSettingsBase,
  setPluginSettingsBase,
  clearPluginSettingsBase,
} from './settings/settingsCache.js'

// --- Settings change detector ---
export {
  initialize as initializeSettingsChangeDetector,
  dispose as disposeSettingsChangeDetector,
  subscribe as subscribeToSettingsChanges,
  notifyChange as notifySettingsChange,
  resetForTesting as resetChangeDetectorForTesting,
  settingsChangeDetector,
} from './settings/changeDetector.js'

// --- Settings Sync ---
export {
  uploadUserSettingsInBackground,
  downloadUserSettings,
  redownloadUserSettings,
  _resetDownloadPromiseForTesting as _resetSyncDownloadPromiseForTesting,
} from './sync/index.js'

export type {
  SettingsSyncFetchResult,
  SettingsSyncUploadResult,
  UserSyncData,
} from './sync/types.js'
export {
  SYNC_KEYS,
  UserSyncContentSchema,
  UserSyncDataSchema,
} from './sync/types.js'

// --- Remote Managed Settings ---
export {
  initializeRemoteManagedSettingsLoadingPromise,
  computeChecksumFromSettings,
  isEligibleForRemoteManagedSettings,
  waitForRemoteManagedSettingsToLoad,
  clearRemoteManagedSettingsCache,
  loadRemoteManagedSettings,
  refreshRemoteManagedSettings,
  startBackgroundPolling,
  stopBackgroundPolling,
} from './remote/index.js'

export {
  isRemoteManagedSettingsEligible,
  isRemoteManagedSettingsEligible as isRemoteEligible,
  resetSyncCache as resetRemoteSyncCache,
} from './remote/syncCache.js'

export {
  getRemoteManagedSettingsSyncFromCache,
  setSessionCache as setRemoteSessionCache,
  getSettingsPath as getRemoteSettingsPath,
  resetSyncCache as resetRemoteSyncCacheState,
  setEligibility,
} from './remote/syncCacheState.js'

export type {
  RemoteManagedSettingsResponse,
  RemoteManagedSettingsFetchResult,
} from './remote/types.js'
export {
  RemoteManagedSettingsResponseSchema,
} from './remote/types.js'

// --- Config Errors (V7 §6.5) ---
export * from './errors.js'
