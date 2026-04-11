// These side-effects must run before all other imports:
// 1. profileCheckpoint marks entry before heavy module evaluation begins
// 2. startMdmRawRead fires MDM subprocesses (plutil/reg query) so they run in
//    parallel with the remaining ~135ms of imports below
// 3. startKeychainPrefetch fires both macOS keychain reads (OAuth + legacy API
//    key) in parallel — isRemoteManagedSettingsEligible() otherwise reads them
//    sequentially via sync spawn inside applySafeConfigEnvironmentVariables()
//    (~65ms on every macOS startup)
import { profileCheckpoint, profileReport } from "./utils/startupProfiler.js";

// eslint-disable-next-line custom-rules/no-top-level-side-effects
profileCheckpoint("main_tsx_entry");

import { startMdmRawRead } from "./utils/settings/mdm/rawRead.js";

// eslint-disable-next-line custom-rules/no-top-level-side-effects
startMdmRawRead();

import {
	ensureKeychainPrefetchCompleted,
	startKeychainPrefetch,
} from "./utils/secureStorage/keychainPrefetch.js";

// eslint-disable-next-line custom-rules/no-top-level-side-effects
startKeychainPrefetch();

import { feature } from "bun:bundle";
import './runtime/bootstrap.js'
import {
	createHeadlessHost,
	createInteractiveHost,
	type InteractiveHostSession,
	type RuntimeHandles,
} from '@claude-code/app-host'
import {
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  getRemoteControlAtStartup,
  isAutoUpdaterDisabled,
  saveGlobalConfig,
} from '@claude-code/config'
import { settingsChangeDetector } from '@claude-code/config/changeDetector'
import { getTools } from '@claude-code/tool-registry'
import {
  Command as CommanderCommand,
  Option,
} from '@commander-js/extra-typings'
import chalk from 'chalk'
import { readFileSync } from 'fs'
import mapValues from 'lodash-es/mapValues.js'
import pickBy from 'lodash-es/pickBy.js'
import uniqBy from 'lodash-es/uniqBy.js'
import React from 'react'
import { getOauthConfig } from './constants/oauth.js'
import { getRemoteSessionUrl } from './constants/product.js'
import { getSystemContext, getUserContext } from './context.js'
import { init, initializeTelemetryAfterTrust } from './entrypoints/init.js'
import { addToHistory } from './history.js'
import type { Root } from '@anthropic/ink'
import { setThemeConfigCallbacks } from '@anthropic/ink'
import { createHeadlessSession } from '@claude-code/cli'
import { getTeammateModeSnapshot, isBeingDebugged, logManagedSettings } from '@claude-code/cli'
import { createSortedHelpConfig, createMainProgram, registerMcpCommands, registerMiscCommands, runModeDispatch } from '@claude-code/cli'
import { launchRepl, type AppWrapperProps } from './replLauncher.js'
import {
	hasGrowthBookEnvOverride,
	initializeGrowthBook,
	refreshGrowthBookAfterAuthChange,
} from "@claude-code/config/feature-flags";
import { fetchBootstrapData } from "./services/api/bootstrap.js";
import {
	type DownloadResult,
	downloadSessionFiles,
	type FilesApiConfig,
	parseFileSpecs,
} from "./services/api/filesApi.js";
import { prefetchPassesEligibility } from "./services/api/referral.js";
import { prefetchOfficialMcpUrls } from "./services/mcp/officialRegistry.js";
import type {
	McpSdkServerConfig,
	McpServerConfig,
	ScopedMcpServerConfig,
} from "./services/mcp/types.js";
import {
	isPolicyAllowed,
	loadPolicyLimits,
	refreshPolicyLimits,
	waitForPolicyLimitsToLoad,
} from "./services/policyLimits/index.js";
import {
	loadRemoteManagedSettings,
	refreshRemoteManagedSettings,
} from "./services/remoteManagedSettings/index.js";
import type { ToolInputJSONSchema } from "./Tool.js";
import {
	createSyntheticOutputTool,
	isSyntheticOutputToolEnabled,
} from "./tools/SyntheticOutputTool/SyntheticOutputTool.js";
import {
	canUserConfigureAdvisor,
	getInitialAdvisorSetting,
	isAdvisorEnabled,
	isValidAdvisorModel,
	modelSupportsAdvisor,
} from "./utils/advisor.js";
import { isAgentSwarmsEnabled } from "./utils/agentSwarmsEnabled.js";
import { count, uniq } from "./utils/array.js";
import { installAsciicastRecorder } from "./utils/asciicast.js";
import {
	getSubscriptionType,
	isClaudeAISubscriber,
	prefetchAwsCredentialsAndBedRockInfoIfSafe,
	prefetchGcpCredentialsIfSafe,
	validateForceLoginOrg,
} from "./utils/auth.js";
import { seedEarlyInput, stopCapturingEarlyInput } from "./utils/earlyInput.js";
import {
	parseEffortValue,
	toPersistableEffort,
} from "./utils/effort.js";
import {
	getFastModeUnavailableReason,
	isFastModeSupportedByModel,
	isFastModeEnabled,
	prefetchFastModeStatus,
	resolveFastModeStatusFromCache,
} from "./utils/fastMode.js";
import { applyConfigEnvironmentVariables } from "./utils/managedEnv.js";
import { extractTeammateOptions, type TeammateOptions } from "./main/cli/options.js";
import { maybeActivateBrief, maybeActivateProactive } from "./main/cli/runtimeActivation.js";
import { prefetchSystemContextIfSafe, startDeferredPrefetches } from "./main/startup/context.js";
import {
	eagerLoadSettings,
	initializeEntrypoint,
	runMigrations,
	loadSettingsFromFlag,
	loadSettingSourcesFromFlag,
} from "./main/startup/settings.js";
import { logSessionTelemetry, logStartupTelemetry } from "./main/startup/telemetry.js";
import {
  createRuntimeHandles,
  syncRuntimeHandlesFromHeadlessParams,
} from './runtime/runtimeHandles.js'
import { createSystemMessage, createUserMessage } from "./utils/messages.js";

export { startDeferredPrefetches };
import { getPlatform } from "./utils/platform.js";
import { getSessionIngressAuthToken } from "./utils/sessionIngressAuth.js";
import { skillChangeDetector } from "./utils/skills/skillChangeDetector.js";
import { jsonParse, writeFileSync_DEPRECATED } from "./utils/slowOperations.js";
import { computeInitialTeamContext } from "@claude-code/swarm";
import { initializeWarningHandler } from "./utils/warningHandler.js";
import { isWorktreeModeEnabled } from "./utils/worktreeModeEnabled.js";

// Lazy require to avoid circular dependency: teammate.ts -> AppState.tsx -> ... -> main.tsx
/* eslint-disable @typescript-eslint/no-require-imports */
const getTeammateUtils = () =>
	require("./utils/teammate.js") as typeof import("./utils/teammate.js");
const getTeammatePromptAddendum = () =>
	require("@claude-code/swarm") as typeof import("@claude-code/swarm");
/* eslint-enable @typescript-eslint/no-require-imports */
// getTeammateModeSnapshot, logManagedSettings, isBeingDebugged moved to @claude-code/cli
// Dead code elimination: conditional import for COORDINATOR_MODE
/* eslint-disable @typescript-eslint/no-require-imports */
const coordinatorModeModule = feature("COORDINATOR_MODE")
	? (require("./coordinator/coordinatorMode.js") as typeof import("./coordinator/coordinatorMode.js"))
	: null;
/* eslint-enable @typescript-eslint/no-require-imports */
// Dead code elimination: conditional import for KAIROS (assistant mode)
/* eslint-disable @typescript-eslint/no-require-imports */
const assistantModule = feature("KAIROS")
	? (require("./assistant/index.js") as typeof import("./assistant/index.js"))
	: null;
const kairosGate = feature("KAIROS")
	? (require("./assistant/gate.js") as typeof import("./assistant/gate.js"))
	: null;

import { relative, resolve } from "path";
import { isAnalyticsDisabled } from "src/services/privacyConfig.js";
import { getFeatureValue_CACHED_MAY_BE_STALE } from "@claude-code/config/feature-flags";
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/eventLogger.js'
import {
	getOriginalCwd,
	setAdditionalDirectoriesForClaudeMd,
	setIsRemoteMode,
	setMainLoopModelOverride,
	setMainThreadAgentType,
	setTeleportedSessionInfo,
} from "./bootstrap/state.js";
import { filterCommandsForRemoteMode, getCommands } from "./commands.js";
import type { StatsStore } from "./context/stats.js";
import {
  launchAssistantInstallWizard,
  launchAssistantSessionChooser,
  launchInvalidSettingsDialog,
  launchResumeChooser,
  launchSnapshotUpdateDialog,
  launchTeleportRepoMismatchDialog,
  launchTeleportResumeWrapper,
} from './dialogLaunchers.js'
import { SHOW_CURSOR } from '@anthropic/ink'
import {
	exitWithError,
	exitWithMessage,
	getRenderContext,
	renderAndRun,
	showSetupScreens,
} from "./interactiveHelpers.js";
import { initBuiltinPlugins } from "./plugins/bundled/index.js";
/* eslint-enable @typescript-eslint/no-require-imports */
import { checkQuotaStatus } from "./services/claudeAiLimits.js";
import {
	getMcpToolsCommandsAndResources,
	prefetchAllMcpResources,
} from "./services/mcp/client.js";
import { initBundledSkills } from "./skills/bundled/index.js";
import type { AgentColorName } from "./tools/AgentTool/agentColorManager.js";
import {
	getActiveAgentsFromList,
	getAgentDefinitionsWithOverrides,
	isBuiltInAgent,
	isCustomAgent,
	parseAgentsFromJson,
} from "./tools/AgentTool/loadAgentsDir.js";
import type { LogOption } from "./types/logs.js";
import type { Message as MessageType } from "./types/message.js";
import {
	CLAUDE_IN_CHROME_SKILL_HINT,
	CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER,
} from "./utils/claudeInChrome/prompt.js";
import {
	setupClaudeInChrome,
	shouldAutoEnableClaudeInChrome,
	shouldEnableClaudeInChrome,
} from "./utils/claudeInChrome/setup.js";
import { getContextWindowForModel } from "./utils/context.js";
import { loadConversationForResume } from "./utils/conversationRecovery.js";
import { buildDeepLinkBanner } from "./utils/deepLink/banner.js";
import {
	hasNodeOption,
	isBareMode,
	isEnvTruthy,
	isInProtectedNamespace,
} from "./utils/envUtils.js";
import { refreshExampleCommands } from "./utils/exampleCommands.js";
import type { FpsMetrics } from "./utils/fpsTracker.js";
import { getWorktreePaths } from "./utils/getWorktreePaths.js";
import {
	findGitRoot,
	getBranch,
	getIsGit,
	getWorktreeCount,
} from "./utils/git.js";
import { getGhAuthStatus } from "./utils/github/ghAuthStatus.js";
import { safeParseJSON } from "./utils/json.js";
import { logError } from "./utils/log.js";
import { getModelDeprecationWarning } from "./utils/model/deprecation.js";
import {
	getDefaultMainLoopModel,
	getUserSpecifiedModelSetting,
	normalizeModelStringForAPI,
	parseUserSpecifiedModel,
} from "./utils/model/model.js";
import { ensureModelStringsInitialized } from "./utils/model/modelStrings.js";
import {
	checkAndDisableBypassPermissions,
	initializeToolPermissionContext,
	initialPermissionModeFromCLI,
	isDefaultPermissionModeAuto,
	parseToolListFromCLI,
	removeDangerousPermissions,
	stripDangerousPermissionsForAutoMode,
	verifyAutoModeGateAccess,
} from "@claude-code/permission/permissionSetup";
import { cleanupOrphanedPluginVersionsInBackground } from "./utils/plugins/cacheUtils.js";
import { initializeVersionedPlugins } from "./utils/plugins/installedPluginsManager.js";
import { getManagedPluginNames } from "./utils/plugins/managedPlugins.js";
import { getGlobExclusionsForPluginCache } from "./utils/plugins/orphanedPluginFilter.js";
import { getPluginSeedDirs } from "./utils/plugins/pluginDirectories.js";
import { countFilesRoundedRg } from "./utils/ripgrep.js";
import {
	processSessionStartHooks,
	processSetupHooks,
} from "./utils/sessionStart.js";
import {
	cacheSessionTitle,
	getSessionIdFromLog,
	loadTranscriptFromFile,
	saveAgentSetting,
	saveMode,
	searchSessionsByCustomTitle,
	sessionIdExists,
} from "./utils/sessionStorage.js";
import { ensureMdmSettingsLoaded } from "./utils/settings/mdm/settings.js";
import {
	getInitialSettings,
	getSettingsForSource,
	getSettingsWithErrors,
} from "./utils/settings/settings.js";
import { resetSettingsCache } from "./utils/settings/settingsCache.js";
import type { ValidationError } from "./utils/settings/validation.js";
import {
	DEFAULT_TASKS_MODE_TASK_LIST_ID,
} from "./utils/tasks.js";
import {
	logPluginLoadErrors,
	logPluginsEnabledForSession,
} from "./utils/telemetry/pluginTelemetry.js";
import { logSkillsLoaded } from "./utils/telemetry/skillLoadedEvent.js";
import { generateTempFilePath } from "./utils/tempfile.js";
import { validateUuid } from "./utils/uuid.js";
// Plugin startup checks are now handled non-blockingly in REPL.tsx

import { logPermissionContextForAnts } from "src/services/internalLogging.js";
import { fetchClaudeAIMcpConfigsIfEligible } from "src/services/mcp/claudeai.js";
import { clearServerCache } from "src/services/mcp/client.js";
import {
	areMcpConfigsAllowedWithEnterpriseMcpConfig,
	dedupClaudeAiMcpServers,
	doesEnterpriseMcpConfigExist,
	filterMcpServersByPolicy,
	getClaudeCodeMcpConfigs,
	getMcpServerSignature,
	parseMcpConfig,
	parseMcpConfigFromFilePath,
} from "src/services/mcp/config.js";
import {
	excludeCommandsByServer,
	excludeResourcesByServer,
} from "src/services/mcp/utils.js";
import { getRelevantTips } from "src/services/tips/tipRegistry.js";
import { logContextMetrics } from "src/utils/api.js";
import {
	CLAUDE_IN_CHROME_MCP_SERVER_NAME,
	isClaudeInChromeMCPServer,
} from "src/utils/claudeInChrome/common.js";
import { registerCleanup } from "src/utils/cleanupRegistry.js";
import { eagerParseCliFlag } from "src/utils/cliArgs.js";
import { createEmptyAttributionState } from "src/utils/commitAttribution.js";
import {
	countConcurrentSessions,
	registerSession,
	updateSessionName,
} from "src/utils/concurrentSessions.js";
import { getCwd } from "src/utils/cwd.js";
import { logForDebugging, setHasFormattedOutput } from "src/utils/debug.js";
import {
	errorMessage,
	getErrnoCode,
	isENOENT,
	TeleportOperationError,
	toError,
} from "src/utils/errors.js";
import {
	getFsImplementation,
	safeResolvePath,
} from "src/utils/fsOperations.js";
import {
	gracefulShutdown,
	gracefulShutdownSync,
} from "src/utils/gracefulShutdown.js";
import { setAllHookEventsEnabled } from "src/utils/hooks/hookEvents.js";
import { refreshModelCapabilities } from "src/utils/model/modelCapabilities.js";
import { peekForStdinData, writeToStderr } from "src/utils/process.js";
import { setCwd } from "src/utils/Shell.js";
import {
	type ProcessedResume,
	processResumedConversation,
} from "src/utils/sessionRestore.js";
import { parseSettingSourcesFlag } from "src/utils/settings/constants.js";
import { plural } from "src/utils/stringUtils.js";
import {
	type ChannelEntry,
	getInitialMainLoopModel,
	getIsNonInteractiveSession,
	getSdkBetas,
	getSessionId,
	getUserMsgOptIn,
	setAllowedChannels,
	setAllowedSettingSources,
	setChromeFlagOverride,
	setClientType,
	setCwdState,
	setDirectConnectServerUrl,
	setFlagSettingsPath,
	setInitialMainLoopModel,
	setInlinePlugins,
	setIsInteractive,
	setKairosActive,
	setOriginalCwd,
	setQuestionPreviewFormat,
	setSdkBetas,
	setSessionBypassPermissionsMode,
	setSessionPersistenceDisabled,
	setSessionSource,
	setUserMsgOptIn,
	switchSession,
} from "./bootstrap/state.js";

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature("TRANSCRIPT_CLASSIFIER")
	? (require("./utils/permissions/autoModeState.js") as typeof import("./utils/permissions/autoModeState.js"))
	: null;

// TeleportRepoMismatchDialog, TeleportResumeWrapper dynamically imported at call sites
import { migrateBypassPermissionsAcceptedToSettings } from "./migrations/migrateBypassPermissionsAcceptedToSettings.js";
import { migrateEnableAllProjectMcpServersToSettings } from "./migrations/migrateEnableAllProjectMcpServersToSettings.js";
import { migrateFennecToOpus } from "./migrations/migrateFennecToOpus.js";
import { migrateLegacyOpusToCurrent } from "./migrations/migrateLegacyOpusToCurrent.js";
import { migrateOpusToOpus1m } from "./migrations/migrateOpusToOpus1m.js";
import { migrateReplBridgeEnabledToRemoteControlAtStartup } from "./migrations/migrateReplBridgeEnabledToRemoteControlAtStartup.js";
import { migrateSonnet1mToSonnet45 } from "./migrations/migrateSonnet1mToSonnet45.js";
import { migrateSonnet45ToSonnet46 } from "./migrations/migrateSonnet45ToSonnet46.js";
import { resetAutoModeOptInForDefaultOffer } from "./migrations/resetAutoModeOptInForDefaultOffer.js";
import { resetProToOpusDefault } from "./migrations/resetProToOpusDefault.js";
import { createRemoteSessionConfig } from "./remote/RemoteSessionManager.js";
/* eslint-enable @typescript-eslint/no-require-imports */
// teleportWithProgress dynamically imported at call site
import {
	createDirectConnectSession,
	DirectConnectError,
} from "./server/createDirectConnectSession.js";
import { initializeLspServerManager } from "./services/lsp/manager.js";
import { shouldEnablePromptSuggestion } from "./services/PromptSuggestion/promptSuggestion.js";
import {
	type AppState,
	IDLE_SPECULATION_STATE,
} from "./state/AppStateStore.js";
import { asSessionId } from "./types/ids.js";
import { filterAllowedSdkBetas } from "./utils/betas.js";
import { isInBundledMode, isRunningWithBun } from "./utils/bundledMode.js";
import { logForDiagnosticsNoPII } from "./utils/diagLogs.js";
import {
	filterExistingPaths,
	getKnownPathsForRepo,
} from "./utils/githubRepoPathMapping.js";
import {
	clearPluginCache,
	loadAllPluginsCacheOnly,
} from "./utils/plugins/pluginLoader.js";
import { migrateChangelogFromConfig } from "./utils/releaseNotes.js";
import { SandboxManager } from "./utils/sandbox/sandbox-adapter.js";
import { fetchSession, prepareApiRequest } from "./utils/teleport/api.js";
import {
	checkOutTeleportedSessionBranch,
	processMessagesForTeleportResume,
	teleportToRemoteWithErrorHandling,
	validateGitState,
	validateSessionRepository,
} from "./utils/teleport.js";
import {
  shouldEnableThinkingByDefault,
  type ThinkingConfig,
} from './utils/thinking.js'
import { initUser, resetUserCache } from './utils/user.js'
import {
	getTmuxInstallInstructions,
	isTmuxAvailable,
	parsePRReference,
} from "@claude-code/swarm";

// eslint-disable-next-line custom-rules/no-top-level-side-effects
profileCheckpoint("main_tsx_imports_loaded");

// Wire up theme config persistence into @anthropic/ink's ThemeProvider.
// eslint-disable-next-line custom-rules/no-top-level-side-effects
setThemeConfigCallbacks({
  loadTheme: () => {
    try {
      return getGlobalConfig().theme
    } catch {
      // ThemeProvider mounts before enableConfigs() in interactive startup.
      // Fall back to a safe default for first render, then later reads use config.
      return 'dark'
    }
  },
  saveTheme: setting => {
    try {
      saveGlobalConfig(c => ({ ...c, theme: setting }))
    } catch {
      // Ignore pre-config startup writes; interactive settings saves happen
      // after enableConfigs() and will persist normally.
    }
  },
})

// logManagedSettings, isBeingDebugged moved to @claude-code/cli (packages/cli/src/entry/bootstrap-utils.ts)




// Set by early argv processing when `claude open <url>` is detected (interactive mode only)
type PendingConnect = {
	url: string | undefined;
	authToken: string | undefined;
	dangerouslySkipPermissions: boolean;
};
const _pendingConnect: PendingConnect | undefined = feature("DIRECT_CONNECT")
	? {
			url: undefined,
			authToken: undefined,
			dangerouslySkipPermissions: false,
		}
	: undefined;

// Set by early argv processing when `claude assistant [sessionId]` is detected
type PendingAssistantChat = { sessionId?: string; discover: boolean };
const _pendingAssistantChat: PendingAssistantChat | undefined = feature(
	"KAIROS",
)
	? { sessionId: undefined, discover: false }
	: undefined;

// `claude ssh <host> [dir]` — parsed from argv early (same pattern as
// DIRECT_CONNECT above) so the main command path can pick it up and hand
// the REPL an SSH-backed session instead of a local one.
type PendingSSH = {
	host: string | undefined;
	cwd: string | undefined;
	permissionMode: string | undefined;
	dangerouslySkipPermissions: boolean;
	/** --local: spawn the child CLI directly, skip ssh/probe/deploy. e2e test mode. */
	local: boolean;
	/** Extra CLI args to forward to the remote CLI on initial spawn (--resume, -c). */
	extraCliArgs: string[];
};
const _pendingSSH: PendingSSH | undefined = feature("SSH_REMOTE")
	? {
			host: undefined,
			cwd: undefined,
			permissionMode: undefined,
			dangerouslySkipPermissions: false,
			local: false,
			extraCliArgs: [],
		}
	: undefined;

export async function main() {
	profileCheckpoint("main_function_start");

	const runtimeHandles = createRuntimeHandles();

	// SECURITY: Prevent Windows from executing commands from current directory
	// This must be set before ANY command execution to prevent PATH hijacking attacks
	// See: https://docs.microsoft.com/en-us/windows/win32/api/processenv/nf-processenv-searchpathw
	process.env.NoDefaultCurrentDirectoryInExePath = "1";

	// Initialize warning handler early to catch warnings
	initializeWarningHandler();

	process.on("exit", () => {
		resetCursor();
	});
	process.on("SIGINT", () => {
		// In print mode, print.ts registers its own SIGINT handler that aborts
		// the in-flight query and calls gracefulShutdown; skip here to avoid
		// preempting it with a synchronous process.exit().
		if (process.argv.includes("-p") || process.argv.includes("--print")) {
			return;
		}
		process.exit(0);
	});
	profileCheckpoint("main_warning_handler_initialized");

	// Check for cc:// or cc+unix:// URL in argv — rewrite so the main command
	// handles it, giving the full interactive TUI instead of a stripped-down subcommand.
	// For headless (-p), we rewrite to the internal `open` subcommand.
	if (feature("DIRECT_CONNECT")) {
		const rawCliArgs = process.argv.slice(2);
		const ccIdx = rawCliArgs.findIndex(
			(a) => a.startsWith("cc://") || a.startsWith("cc+unix://"),
		);
		if (ccIdx !== -1 && _pendingConnect) {
			const ccUrl = rawCliArgs[ccIdx]!;
			const { parseConnectUrl } =
				await import("./server/parseConnectUrl.js");
			const parsed = parseConnectUrl(ccUrl);
			_pendingConnect.dangerouslySkipPermissions = rawCliArgs.includes(
				"--dangerously-skip-permissions",
			);

			if (rawCliArgs.includes("-p") || rawCliArgs.includes("--print")) {
				// Headless: rewrite to internal `open` subcommand
				const stripped = rawCliArgs.filter((_, i) => i !== ccIdx);
				const dspIdx = stripped.indexOf(
					"--dangerously-skip-permissions",
				);
				if (dspIdx !== -1) {
					stripped.splice(dspIdx, 1);
				}
				process.argv = [
					process.argv[0]!,
					process.argv[1]!,
					"open",
					ccUrl,
					...stripped,
				];
			} else {
				// Interactive: strip cc:// URL and flags, run main command
				_pendingConnect.url = parsed.serverUrl;
				_pendingConnect.authToken = parsed.authToken;
				const stripped = rawCliArgs.filter((_, i) => i !== ccIdx);
				const dspIdx = stripped.indexOf(
					"--dangerously-skip-permissions",
				);
				if (dspIdx !== -1) {
					stripped.splice(dspIdx, 1);
				}
				process.argv = [
					process.argv[0]!,
					process.argv[1]!,
					...stripped,
				];
			}
		}
	}

	// Handle deep link URIs early — this is invoked by the OS protocol handler
	// and should bail out before full init since it only needs to parse the URI
	// and open a terminal.
	if (feature("LODESTONE")) {
		const handleUriIdx = process.argv.indexOf("--handle-uri");
		if (handleUriIdx !== -1 && process.argv[handleUriIdx + 1]) {
			const { enableConfigs } = await import("@claude-code/config");
			enableConfigs();
			const uri = process.argv[handleUriIdx + 1]!;
			const { handleDeepLinkUri } =
				await import("./utils/deepLink/protocolHandler.js");
			const exitCode = await handleDeepLinkUri(uri);
			process.exit(exitCode);
		}

		// macOS URL handler: when LaunchServices launches our .app bundle, the
		// URL arrives via Apple Event (not argv). LaunchServices overwrites
		// __CFBundleIdentifier to the launching bundle's ID, which is a precise
		// positive signal — cheaper than importing and guessing with heuristics.
		if (
			process.platform === "darwin" &&
			process.env.__CFBundleIdentifier ===
				"com.anthropic.claude-code-url-handler"
		) {
			const { enableConfigs } = await import("@claude-code/config");
			enableConfigs();
			const { handleUrlSchemeLaunch } =
				await import("./utils/deepLink/protocolHandler.js");
			const urlSchemeResult = await handleUrlSchemeLaunch();
			process.exit(urlSchemeResult ?? 1);
		}
	}

	// `claude assistant [sessionId]` — stash and strip so the main
	// command handles it, giving the full interactive TUI. Position-0 only
	// (matching the ssh pattern below) — indexOf would false-positive on
	// `claude -p "explain assistant"`. Root-flag-before-subcommand
	// (e.g. `--debug assistant`) falls through to the stub, which
	// prints usage.
	if (feature("KAIROS") && _pendingAssistantChat) {
		const rawArgs = process.argv.slice(2);
		if (rawArgs[0] === "assistant") {
			const nextArg = rawArgs[1];
			if (nextArg && !nextArg.startsWith("-")) {
				_pendingAssistantChat.sessionId = nextArg;
				rawArgs.splice(0, 2); // drop 'assistant' and sessionId
				process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs];
			} else if (!nextArg) {
				_pendingAssistantChat.discover = true;
				rawArgs.splice(0, 1); // drop 'assistant'
				process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs];
			}
			// else: `claude assistant --help` → fall through to stub
		}
	}

	// `claude ssh <host> [dir]` — strip from argv so the main command handler
	// runs (full interactive TUI), stash the host/dir for the REPL branch at
	// ~line 3720 to pick up. Headless (-p) mode not supported in v1: SSH
	// sessions need the local REPL to drive them (interrupt, permissions).
	if (feature("SSH_REMOTE") && _pendingSSH) {
		const rawCliArgs = process.argv.slice(2);
		// SSH-specific flags can appear before the host positional (e.g.
		// `ssh --permission-mode auto host /tmp` — standard POSIX flags-before-
		// positionals). Pull them all out BEFORE checking whether a host was
		// given, so `claude ssh --permission-mode auto host` and `claude ssh host
		// --permission-mode auto` are equivalent. The host check below only needs
		// to guard against `-h`/`--help` (which commander should handle).
		if (rawCliArgs[0] === "ssh") {
			const localIdx = rawCliArgs.indexOf("--local");
			if (localIdx !== -1) {
				_pendingSSH.local = true;
				rawCliArgs.splice(localIdx, 1);
			}
			const dspIdx = rawCliArgs.indexOf("--dangerously-skip-permissions");
			if (dspIdx !== -1) {
				_pendingSSH.dangerouslySkipPermissions = true;
				rawCliArgs.splice(dspIdx, 1);
			}
			const pmIdx = rawCliArgs.indexOf("--permission-mode");
			if (
				pmIdx !== -1 &&
				rawCliArgs[pmIdx + 1] &&
				!rawCliArgs[pmIdx + 1]!.startsWith("-")
			) {
				_pendingSSH.permissionMode = rawCliArgs[pmIdx + 1];
				rawCliArgs.splice(pmIdx, 2);
			}
			const pmEqIdx = rawCliArgs.findIndex((a) =>
				a.startsWith("--permission-mode="),
			);
			if (pmEqIdx !== -1) {
				_pendingSSH.permissionMode = rawCliArgs[pmEqIdx]!.split("=")[1];
				rawCliArgs.splice(pmEqIdx, 1);
			}
			// Forward session-resume + model flags to the remote CLI's initial spawn.
			// --continue/-c and --resume <uuid> operate on the REMOTE session history
			// (which persists under the remote's ~/.claude/projects/<cwd>/).
			// --model controls which model the remote uses.
			const extractFlag = (
				flag: string,
				opts: { hasValue?: boolean; as?: string } = {},
			) => {
				const i = rawCliArgs.indexOf(flag);
				if (i !== -1) {
					_pendingSSH.extraCliArgs.push(opts.as ?? flag);
					const val = rawCliArgs[i + 1];
					if (opts.hasValue && val && !val.startsWith("-")) {
						_pendingSSH.extraCliArgs.push(val);
						rawCliArgs.splice(i, 2);
					} else {
						rawCliArgs.splice(i, 1);
					}
				}
				const eqI = rawCliArgs.findIndex((a) =>
					a.startsWith(`${flag}=`),
				);
				if (eqI !== -1) {
					_pendingSSH.extraCliArgs.push(
						opts.as ?? flag,
						rawCliArgs[eqI]!.slice(flag.length + 1),
					);
					rawCliArgs.splice(eqI, 1);
				}
			};
			extractFlag("-c", { as: "--continue" });
			extractFlag("--continue");
			extractFlag("--resume", { hasValue: true });
			extractFlag("--model", { hasValue: true });
		}
		// After pre-extraction, any remaining dash-arg at [1] is either -h/--help
		// (commander handles) or an unknown-to-ssh flag (fall through to commander
		// so it surfaces a proper error). Only a non-dash arg is the host.
		if (
			rawCliArgs[0] === "ssh" &&
			rawCliArgs[1] &&
			!rawCliArgs[1].startsWith("-")
		) {
			_pendingSSH.host = rawCliArgs[1];
			// Optional positional cwd.
			let consumed = 2;
			if (rawCliArgs[2] && !rawCliArgs[2].startsWith("-")) {
				_pendingSSH.cwd = rawCliArgs[2];
				consumed = 3;
			}
			const rest = rawCliArgs.slice(consumed);

			// Headless (-p) mode is not supported with SSH in v1 — reject early
			// so the flag doesn't silently cause local execution.
			if (rest.includes("-p") || rest.includes("--print")) {
				process.stderr.write(
					"Error: headless (-p/--print) mode is not supported with claude ssh\n",
				);
				gracefulShutdownSync(1);
				return;
			}

			// Rewrite argv so the main command sees remaining flags but not `ssh`.
			process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
		}
	}

	// Check for -p/--print and --init-only flags early to set isInteractiveSession before init()
	// This is needed because telemetry initialization calls auth functions that need this flag
	const cliArgs = process.argv.slice(2);
	const hasPrintFlag = cliArgs.includes("-p") || cliArgs.includes("--print");
	const hasInitOnlyFlag = cliArgs.includes("--init-only");
	const hasSdkUrl = cliArgs.some((arg) => arg.startsWith("--sdk-url"));
	const isNonInteractive =
		hasPrintFlag || hasInitOnlyFlag || hasSdkUrl || !process.stdout.isTTY;

	// Stop capturing early input for non-interactive modes
	if (isNonInteractive) {
		stopCapturingEarlyInput();
	}

	// Set simplified tracking fields
	const isInteractive = !isNonInteractive;
	setIsInteractive(isInteractive);

	// Initialize entrypoint based on mode - needs to be set before any event is logged
	initializeEntrypoint(isNonInteractive);

	// Determine client type
	const clientType = (() => {
		if (isEnvTruthy(process.env.GITHUB_ACTIONS)) return "github-action";
		if (process.env.CLAUDE_CODE_ENTRYPOINT === "sdk-ts")
			return "sdk-typescript";
		if (process.env.CLAUDE_CODE_ENTRYPOINT === "sdk-py")
			return "sdk-python";
		if (process.env.CLAUDE_CODE_ENTRYPOINT === "sdk-cli") return "sdk-cli";
		if (process.env.CLAUDE_CODE_ENTRYPOINT === "claude-vscode")
			return "claude-vscode";
		if (process.env.CLAUDE_CODE_ENTRYPOINT === "local-agent")
			return "local-agent";
		if (process.env.CLAUDE_CODE_ENTRYPOINT === "claude-desktop")
			return "claude-desktop";

		// Check if session-ingress token is provided (indicates remote session)
		const hasSessionIngressToken =
			process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN ||
			process.env.CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR;
		if (
			process.env.CLAUDE_CODE_ENTRYPOINT === "remote" ||
			hasSessionIngressToken
		) {
			return "remote";
		}

		return "cli";
	})();
	setClientType(clientType);

	const previewFormat = process.env.CLAUDE_CODE_QUESTION_PREVIEW_FORMAT;
	if (previewFormat === "markdown" || previewFormat === "html") {
		setQuestionPreviewFormat(previewFormat);
	} else if (
		!clientType.startsWith("sdk-") &&
		// Desktop and CCR pass previewFormat via toolConfig; when the feature is
		// gated off they pass undefined — don't override that with markdown.
		clientType !== "claude-desktop" &&
		clientType !== "local-agent" &&
		clientType !== "remote"
	) {
		setQuestionPreviewFormat("markdown");
	}

	// Tag sessions created via `claude remote-control` so the backend can identify them
	if (process.env.CLAUDE_CODE_ENVIRONMENT_KIND === "bridge") {
		setSessionSource("remote-control");
	}

	profileCheckpoint("main_client_type_determined");

	// Parse and load settings flags early, before init()
	eagerLoadSettings();

	profileCheckpoint("main_before_run");

	await run(runtimeHandles);
	profileCheckpoint("main_after_run");
}

async function getInputPrompt(
	prompt: string,
	inputFormat: "text" | "stream-json",
): Promise<string | AsyncIterable<string>> {
	if (
		!process.stdin.isTTY &&
		// Input hijacking breaks MCP.
		!process.argv.includes("mcp")
	) {
		if (inputFormat === "stream-json") {
			return process.stdin;
		}
		process.stdin.setEncoding("utf8");
		let data = "";
		const onData = (chunk: string) => {
			data += chunk;
		};
		process.stdin.on("data", onData);
		// If no data arrives in 3s, stop waiting and warn. Stdin is likely an
		// inherited pipe from a parent that isn't writing (subprocess spawned
		// without explicit stdin handling). 3s covers slow producers like curl,
		// jq on large files, python with import overhead. The warning makes
		// silent data loss visible for the rare producer that's slower still.
		const timedOut = await peekForStdinData(process.stdin, 3000);
		process.stdin.off("data", onData);
		if (timedOut) {
			process.stderr.write(
				"Warning: no stdin data received in 3s, proceeding without it. " +
					"If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.\n",
			);
		}
		return [prompt, data].filter(Boolean).join("\n");
	}
	return prompt;
}

async function run(runtimeHandles: RuntimeHandles): Promise<CommanderCommand> {
	profileCheckpoint("run_function_start");

	const program = createMainProgram();
	profileCheckpoint("run_commander_initialized");

	// Use preAction hook to run initialization only when executing a command,
	// not when displaying help. This avoids the need for env variable signaling.
	program.hook("preAction", async (thisCommand) => {
		profileCheckpoint("preAction_start");
		// Await async subprocess loads started at module evaluation (lines 12-20).
		// Nearly free — subprocesses complete during the ~135ms of imports above.
		// Must resolve before init() which triggers the first settings read
		// (applySafeConfigEnvironmentVariables → getSettingsForSource('policySettings')
		// → isRemoteManagedSettingsEligible → sync keychain reads otherwise ~65ms).
		await Promise.all([
			ensureMdmSettingsLoaded(),
			ensureKeychainPrefetchCompleted(),
		]);
		profileCheckpoint("preAction_after_mdm");
		await init();
		profileCheckpoint("preAction_after_init");

		// process.title on Windows sets the console title directly; on POSIX,
		// terminal shell integration may mirror the process name to the tab.
		// After init() so settings.json env can also gate this (gh-4765).
		if (!isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE)) {
			process.title = "claude";
		}

		// Attach logging sinks so subcommand handlers can use logEvent/logError.
		// Before PR #11106 logEvent dispatched directly; after, events queue until
		// a sink attaches. setup() attaches sinks for the default command, but
		// subcommands (doctor, mcp, plugin, auth) never call setup() and would
		// silently drop events on process.exit(). Both inits are idempotent.
		const { initSinks } = await import("./utils/sinks.js");
		initSinks();
		profileCheckpoint("preAction_after_sinks");

		// gh-33508: --plugin-dir is a top-level program option. The default
		// action reads it from its own options destructure, but subcommands
		// (plugin list, plugin install, mcp *) have their own actions and
		// never see it. Wire it up here so getInlinePlugins() works everywhere.
		// thisCommand.opts() is typed {} here because this hook is attached
		// before .option('--plugin-dir', ...) in the chain — extra-typings
		// builds the type as options are added. Narrow with a runtime guard;
		// the collect accumulator + [] default guarantee string[] in practice.
		const pluginDir = thisCommand.getOptionValue("pluginDir");
		if (
			Array.isArray(pluginDir) &&
			pluginDir.length > 0 &&
			pluginDir.every((p) => typeof p === "string")
		) {
			setInlinePlugins(pluginDir);
			clearPluginCache("preAction: --plugin-dir inline plugins");
		}

		runMigrations();
		profileCheckpoint("preAction_after_migrations");

		// Load remote managed settings for enterprise customers (non-blocking)
		// Fails open - if fetch fails, continues without remote settings
		// Settings are applied via hot-reload when they arrive
		// Must happen after init() to ensure config reading is allowed
		void loadRemoteManagedSettings();
		void loadPolicyLimits();

		profileCheckpoint("preAction_after_remote_settings");

		// Load settings sync (non-blocking, fail-open)
		// CLI: uploads local settings to remote (CCR download is handled by print.ts)
		if (feature("UPLOAD_USER_SETTINGS")) {
			void import("./services/settingsSync/index.js").then((m) =>
				m.uploadUserSettingsInBackground(),
			);
		}

		profileCheckpoint("preAction_after_settings_sync");
	});

	program.action(async (prompt, options) => {
		await runModeDispatch(prompt, options as Record<string, unknown>, {
			runtimeHandles,
			pendingConnect: _pendingConnect,
			pendingSSH: _pendingSSH,
			pendingAssistantChat: _pendingAssistantChat,
		});
		})
		.version(
			`${MACRO.VERSION} (Claude Code)`,
			"-v, --version",
			"Output the version number",
		);

	// Worktree flags
	program.option(
		"-w, --worktree [name]",
		"Create a new git worktree for this session (optionally specify a name)",
	);
	program.option(
		"--tmux",
		"Create a tmux session for the worktree (requires --worktree). Uses iTerm2 native panes when available; use --tmux=classic for traditional tmux.",
	);

	if (canUserConfigureAdvisor()) {
		program.addOption(
			new Option(
				"--advisor <model>",
				"Enable the server-side advisor tool with the specified model (alias or full ID).",
			).hideHelp(),
		);
	}

	if (process.env.USER_TYPE === "ant") {
		program.addOption(
			new Option(
				"--delegate-permissions",
				"[ANT-ONLY] Alias for --permission-mode auto.",
			).implies({
				permissionMode: "auto",
			}),
		);
		program.addOption(
			new Option(
				"--dangerously-skip-permissions-with-classifiers",
				"[ANT-ONLY] Deprecated alias for --permission-mode auto.",
			)
				.hideHelp()
				.implies({ permissionMode: "auto" }),
		);
		program.addOption(
			new Option(
				"--afk",
				"[ANT-ONLY] Deprecated alias for --permission-mode auto.",
			)
				.hideHelp()
				.implies({ permissionMode: "auto" }),
		);
		program.addOption(
			new Option(
				"--tasks [id]",
				'[ANT-ONLY] Tasks mode: watch for tasks and auto-process them. Optional id is used as both the task list ID and agent ID (defaults to "tasklist").',
			)
				.argParser(String)
				.hideHelp(),
		);
		program.option(
			"--agent-teams",
			"[ANT-ONLY] Force Claude to use multi-agent mode for solving problems",
			() => true,
		);
	}

	if (feature("TRANSCRIPT_CLASSIFIER")) {
		program.addOption(
			new Option("--enable-auto-mode", "Opt in to auto mode").hideHelp(),
		);
	}

	if (feature("PROACTIVE") || feature("KAIROS")) {
		program.addOption(
			new Option("--proactive", "Start in proactive autonomous mode"),
		);
	}

	if (feature("UDS_INBOX")) {
		program.addOption(
			new Option(
				"--messaging-socket-path <path>",
				"Unix domain socket path for the UDS messaging server (defaults to a tmp path)",
			),
		);
	}

	if (feature("KAIROS") || feature("KAIROS_BRIEF")) {
		program.addOption(
			new Option(
				"--brief",
				"Enable SendUserMessage tool for agent-to-user communication",
			),
		);
	}
	if (feature("KAIROS")) {
		program.addOption(
			new Option(
				"--assistant",
				"Force assistant mode (Agent SDK daemon use)",
			).hideHelp(),
		);
	}
	if (feature("KAIROS") || feature("KAIROS_CHANNELS")) {
		program.addOption(
			new Option(
				"--channels <servers...>",
				"MCP servers whose channel notifications (inbound push) should register this session. Space-separated server names.",
			).hideHelp(),
		);
		program.addOption(
			new Option(
				"--dangerously-load-development-channels <servers...>",
				"Load channel servers not on the approved allowlist. For local channel development only. Shows a confirmation dialog at startup.",
			).hideHelp(),
		);
	}

	// Teammate identity options (set by leader when spawning tmux teammates)
	// These replace the CLAUDE_CODE_* environment variables
	program.addOption(
		new Option("--agent-id <id>", "Teammate agent ID").hideHelp(),
	);
	program.addOption(
		new Option("--agent-name <name>", "Teammate display name").hideHelp(),
	);
	program.addOption(
		new Option(
			"--team-name <name>",
			"Team name for swarm coordination",
		).hideHelp(),
	);
	program.addOption(
		new Option("--agent-color <color>", "Teammate UI color").hideHelp(),
	);
	program.addOption(
		new Option(
			"--plan-mode-required",
			"Require plan mode before implementation",
		).hideHelp(),
	);
	program.addOption(
		new Option(
			"--parent-session-id <id>",
			"Parent session ID for analytics correlation",
		).hideHelp(),
	);
	program.addOption(
		new Option(
			"--teammate-mode <mode>",
			'How to spawn teammates: "tmux", "in-process", or "auto"',
		)
			.choices(["auto", "tmux", "in-process"])
			.hideHelp(),
	);
	program.addOption(
		new Option(
			"--agent-type <type>",
			"Custom agent type for this teammate",
		).hideHelp(),
	);

	// Enable SDK URL for all builds but hide from help
	program.addOption(
		new Option(
			"--sdk-url <url>",
			"Use remote WebSocket endpoint for SDK I/O streaming (only with -p and stream-json format)",
		).hideHelp(),
	);

	// Enable teleport/remote flags for all builds but keep them undocumented until GA
	program.addOption(
		new Option(
			"--teleport [session]",
			"Resume a teleport session, optionally specify session ID",
		).hideHelp(),
	);
	program.addOption(
		new Option(
			"--remote [description]",
			"Create a remote session with the given description",
		).hideHelp(),
	);
	if (feature("BRIDGE_MODE")) {
		program.addOption(
			new Option(
				"--remote-control [name]",
				"Start an interactive session with Remote Control enabled (optionally named)",
			)
				.argParser((value) => value || true)
				.hideHelp(),
		);
		program.addOption(
			new Option("--rc [name]", "Alias for --remote-control")
				.argParser((value) => value || true)
				.hideHelp(),
		);
	}

	if (feature("HARD_FAIL")) {
		program.addOption(
			new Option(
				"--hard-fail",
				"Crash on logError calls instead of silently logging",
			).hideHelp(),
		);
	}

	profileCheckpoint("run_main_options_built");

	// -p/--print mode: skip subcommand registration. The 52 subcommands
	// (mcp, auth, plugin, skill, task, config, doctor, update, etc.) are
	// never dispatched in print mode — commander routes the prompt to the
	// default action. The subcommand registration path was measured at ~65ms
	// on baseline — mostly the isBridgeEnabled() call (25ms settings Zod parse
	// + 40ms sync keychain subprocess), both hidden by the try/catch that
	// always returns false before enableConfigs(). cc:// URLs are rewritten to
	// `open` at main() line ~851 BEFORE this runs, so argv check is safe here.
	const isPrintMode =
		process.argv.includes("-p") || process.argv.includes("--print");
	const isCcUrl = process.argv.some(
		(a) => a.startsWith("cc://") || a.startsWith("cc+unix://"),
	);
	if (isPrintMode && !isCcUrl) {
		profileCheckpoint("run_before_parse");
		await program.parseAsync(process.argv);
		profileCheckpoint("run_after_parse");
		return program;
	}

	// claude mcp + server + ssh + open (extracted to @claude-code/cli)
	registerMcpCommands(program, { pendingConnect: _pendingConnect });

	// claude auth/plugin/setup-token/agents/auto-mode/remote-control/assistant/doctor/up/rollback/install/log/error/export/task/completion (extracted to @claude-code/cli)
	registerMiscCommands(program);

	profileCheckpoint("run_before_parse");
	await program.parseAsync(process.argv);
	profileCheckpoint("run_after_parse");

	// Record final checkpoint for total_time calculation
	profileCheckpoint("main_after_run");

	// Log startup perf to Statsig (sampled) and output detailed report if enabled
	profileReport();

	return program;
}

async function logTenguInit({
	hasInitialPrompt,
	hasStdin,
	verbose,
	debug,
	debugToStderr,
	print,
	outputFormat,
	inputFormat,
	numAllowedTools,
	numDisallowedTools,
	mcpClientCount,
	worktreeEnabled,
	skipWebFetchPreflight,
	githubActionInputs,
	dangerouslySkipPermissionsPassed,
	permissionMode,
	modeIsBypass,
	allowDangerouslySkipPermissionsPassed,
	systemPromptFlag,
	appendSystemPromptFlag,
	thinkingConfig,
	assistantActivationPath,
}: {
	hasInitialPrompt: boolean;
	hasStdin: boolean;
	verbose: boolean;
	debug: boolean;
	debugToStderr: boolean;
	print: boolean;
	outputFormat: string;
	inputFormat: string;
	numAllowedTools: number;
	numDisallowedTools: number;
	mcpClientCount: number;
	worktreeEnabled: boolean;
	skipWebFetchPreflight: boolean | undefined;
	githubActionInputs: string | undefined;
	dangerouslySkipPermissionsPassed: boolean;
	permissionMode: string;
	modeIsBypass: boolean;
	allowDangerouslySkipPermissionsPassed: boolean;
	systemPromptFlag: "file" | "flag" | undefined;
	appendSystemPromptFlag: "file" | "flag" | undefined;
	thinkingConfig: ThinkingConfig;
	assistantActivationPath: string | undefined;
}): Promise<void> {
	try {
		logEvent("tengu_init", {
			entrypoint:
				"claude" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			hasInitialPrompt,
			hasStdin,
			verbose,
			debug,
			debugToStderr,
			print,
			outputFormat:
				outputFormat as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			inputFormat:
				inputFormat as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			numAllowedTools,
			numDisallowedTools,
			mcpClientCount,
			worktree: worktreeEnabled,
			skipWebFetchPreflight,
			...(githubActionInputs && {
				githubActionInputs:
					githubActionInputs as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			}),
			dangerouslySkipPermissionsPassed,
			permissionMode:
				permissionMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			modeIsBypass,
			inProtectedNamespace: isInProtectedNamespace(),
			allowDangerouslySkipPermissionsPassed,
			thinkingType:
				thinkingConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			...(systemPromptFlag && {
				systemPromptFlag:
					systemPromptFlag as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			}),
			...(appendSystemPromptFlag && {
				appendSystemPromptFlag:
					appendSystemPromptFlag as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			}),
			is_simple: isBareMode() || undefined,
			is_coordinator:
				feature("COORDINATOR_MODE") &&
				coordinatorModeModule?.isCoordinatorMode()
					? true
					: undefined,
			...(assistantActivationPath && {
				assistantActivationPath:
					assistantActivationPath as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			}),
			autoUpdatesChannel: (getInitialSettings().autoUpdatesChannel ??
				"latest") as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			...(process.env.USER_TYPE === "ant"
				? (() => {
						const cwd = getCwd();
						const gitRoot = findGitRoot(cwd);
						const rp = gitRoot
							? relative(gitRoot, cwd) || "."
							: undefined;
						return rp
							? {
									relativeProjectPath:
										rp as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
								}
							: {};
					})()
				: {}),
		});
	} catch (error) {
		logError(error);
	}
}

function resetCursor() {
	const terminal = process.stderr.isTTY
		? process.stderr
		: process.stdout.isTTY
			? process.stdout
			: undefined;
	terminal?.write(SHOW_CURSOR);
}
