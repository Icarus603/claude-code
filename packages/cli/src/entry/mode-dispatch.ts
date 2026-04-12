/**
 * Mode dispatch handler extracted from src/main.tsx.
 * Contains the main run() .action() handler body.
 *
 * Structural move only — no logic changed.
 * Moved from src/main.tsx per V7 Phase 4 cut-E.
 */

import { feature } from 'bun:bundle'
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
import { getTools } from '@claude-code/tool-registry'
import chalk from 'chalk'
import { readFileSync } from 'fs'
import mapValues from 'lodash-es/mapValues.js'
import pickBy from 'lodash-es/pickBy.js'
import uniqBy from 'lodash-es/uniqBy.js'
import React from 'react'
import { getOauthConfig } from '../../../../src/constants/oauth.js'
import { getRemoteSessionUrl } from '../../../../src/constants/product.js'
import { getSystemContext, getUserContext } from '../../../../src/context.js'
import { init, initializeTelemetryAfterTrust } from '../../../../src/entrypoints/init.js'
import { addToHistory } from '../../../../src/history.js'
import type { Root } from '@anthropic/ink'
import { createHeadlessSession } from '@claude-code/cli'
import { getTeammateModeSnapshot, logManagedSettings } from '@claude-code/cli'
import { launchRepl, type AppWrapperProps } from '../../../../src/replLauncher.js'
import { initializeLspServerManager } from '../../../../src/services/lsp/manager.js'
// Imports that were left behind when the .action() body moved from src/main.tsx
// at commit 903c46b — the callsites survived the move, the import statements
// didn't. Without these, each call site throws `undefined is not a function`,
// which Ink's patchConsole swallows, leaving the REPL at a blank screen.
import { shouldEnablePromptSuggestion } from '../../../../src/services/PromptSuggestion/promptSuggestion.js'
import {
  createDirectConnectSession,
  DirectConnectError,
} from '../../../../src/server/createDirectConnectSession.js'
import { createRemoteSessionConfig } from '../../../../src/remote/RemoteSessionManager.js'
import {
  hasGrowthBookEnvOverride,
  initializeGrowthBook,
  refreshGrowthBookAfterAuthChange,
} from '@claude-code/config/feature-flags'
import { fetchBootstrapData } from '../../../../src/services/api/bootstrap.js'
import {
  type DownloadResult,
  downloadSessionFiles,
  type FilesApiConfig,
  parseFileSpecs,
} from '../../../../src/services/api/filesApi.js'
import { prefetchPassesEligibility } from '../../../../src/services/api/referral.js'
import type {
  McpSdkServerConfig,
  McpServerConfig,
  ScopedMcpServerConfig,
} from '../../../../src/services/mcp/types.js'
import {
  isPolicyAllowed,
  loadPolicyLimits,
  refreshPolicyLimits,
  waitForPolicyLimitsToLoad,
} from '../../../../src/services/policyLimits/index.js'
import {
  loadRemoteManagedSettings,
  refreshRemoteManagedSettings,
} from '../../../../src/services/remoteManagedSettings/index.js'
import type { ToolInputJSONSchema } from '../../../../src/Tool.js'
import {
  createSyntheticOutputTool,
  isSyntheticOutputToolEnabled,
} from '../../../../src/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import {
  canUserConfigureAdvisor,
  getInitialAdvisorSetting,
  isAdvisorEnabled,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from '../../../../src/utils/advisor.js'
import { isAgentSwarmsEnabled } from '../../../../src/utils/agentSwarmsEnabled.js'
import { count, uniq } from '../../../../src/utils/array.js'
import { installAsciicastRecorder } from '../../../../src/utils/asciicast.js'
import {
  getSubscriptionType,
  isClaudeAISubscriber,
  prefetchAwsCredentialsAndBedRockInfoIfSafe,
  prefetchGcpCredentialsIfSafe,
  validateForceLoginOrg,
} from '../../../../src/utils/auth.js'
import { seedEarlyInput, stopCapturingEarlyInput } from '../../../../src/utils/earlyInput.js'
import {
  parseEffortValue,
  toPersistableEffort,
} from '../../../../src/utils/effort.js'
import {
  getFastModeUnavailableReason,
  isFastModeSupportedByModel,
  isFastModeEnabled,
  prefetchFastModeStatus,
  resolveFastModeStatusFromCache,
} from '../../../../src/utils/fastMode.js'
import { applyConfigEnvironmentVariables } from '../../../../src/utils/managedEnv.js'
import { extractTeammateOptions, type TeammateOptions } from '../../../../src/main/cli/options.js'
import { maybeActivateBrief, maybeActivateProactive } from '../../../../src/main/cli/runtimeActivation.js'
import { prefetchSystemContextIfSafe, startDeferredPrefetches } from '../../../../src/main/startup/context.js'
import {
  eagerLoadSettings,
  initializeEntrypoint,
  runMigrations,
  loadSettingsFromFlag,
  loadSettingSourcesFromFlag,
} from '../../../../src/main/startup/settings.js'
import { logSessionTelemetry, logStartupTelemetry } from '../../../../src/main/startup/telemetry.js'
import {
  createRuntimeHandles,
  syncRuntimeHandlesFromHeadlessParams,
} from '../../../../src/runtime/runtimeHandles.js'
import { createSystemMessage, createUserMessage } from '../../../../src/utils/messages.js'
import { getPlatform } from '../../../../src/utils/platform.js'
import { getSessionIngressAuthToken } from '../../../../src/utils/sessionIngressAuth.js'
import { jsonParse, writeFileSync_DEPRECATED } from '../../../../src/utils/slowOperations.js'
import { computeInitialTeamContext } from '@claude-code/swarm'
import { isWorktreeModeEnabled } from '../../../../src/utils/worktreeModeEnabled.js'
import { relative, resolve } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../../../src/services/eventLogger.js'
import {
  getOriginalCwd,
  setAdditionalDirectoriesForClaudeMd,
  setIsRemoteMode,
  setMainLoopModelOverride,
  setMainThreadAgentType,
  setTeleportedSessionInfo,
} from '../../../../src/bootstrap/state.js'
import { filterCommandsForRemoteMode, getCommands } from '../../../../src/commands.js'
import type { StatsStore } from '../../../../src/context/stats.js'
import {
  launchAssistantInstallWizard,
  launchAssistantSessionChooser,
  launchInvalidSettingsDialog,
  launchResumeChooser,
  launchSnapshotUpdateDialog,
  launchTeleportRepoMismatchDialog,
  launchTeleportResumeWrapper,
} from '../../../../src/dialogLaunchers.js'
import {
  exitWithError,
  exitWithMessage,
  getRenderContext,
  renderAndRun,
  showSetupScreens,
} from '../../../../src/interactiveHelpers.js'
import { initBuiltinPlugins } from '../../../../src/plugins/bundled/index.js'
import { checkQuotaStatus } from '../../../../src/services/claudeAiLimits.js'
import {
  getMcpToolsCommandsAndResources,
  prefetchAllMcpResources,
} from '../../../../src/services/mcp/client.js'
import { initBundledSkills } from '../../../../src/skills/bundled/index.js'
import type { AgentColorName } from '../../../../src/tools/AgentTool/agentColorManager.js'
import {
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
  isBuiltInAgent,
  isCustomAgent,
  parseAgentsFromJson,
} from '../../../../src/tools/AgentTool/loadAgentsDir.js'
import type { LogOption } from '../../../../src/types/logs.js'
import type { Message as MessageType } from '../../../../src/types/message.js'
import {
  CLAUDE_IN_CHROME_SKILL_HINT,
  CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER,
} from '../../../../src/utils/claudeInChrome/prompt.js'
import {
  setupClaudeInChrome,
  shouldAutoEnableClaudeInChrome,
  shouldEnableClaudeInChrome,
} from '../../../../src/utils/claudeInChrome/setup.js'
import { getContextWindowForModel } from '../../../../src/utils/context.js'
import { loadConversationForResume } from '../../../../src/utils/conversationRecovery.js'
import { buildDeepLinkBanner } from '../../../../src/utils/deepLink/banner.js'
import {
  hasNodeOption,
  isBareMode,
  isEnvTruthy,
  isInProtectedNamespace,
} from '../../../../src/utils/envUtils.js'
import { refreshExampleCommands } from '../../../../src/utils/exampleCommands.js'
import type { FpsMetrics } from '../../../../src/utils/fpsTracker.js'
import { getWorktreePaths } from '../../../../src/utils/getWorktreePaths.js'
import {
  findGitRoot,
  getBranch,
  getIsGit,
  getWorktreeCount,
} from '../../../../src/utils/git.js'
import { getGhAuthStatus } from '../../../../src/utils/github/ghAuthStatus.js'
import { safeParseJSON } from '../../../../src/utils/json.js'
import { logError } from '../../../../src/utils/log.js'
import { getModelDeprecationWarning } from '../../../../src/utils/model/deprecation.js'
import {
  getDefaultMainLoopModel,
  getUserSpecifiedModelSetting,
  normalizeModelStringForAPI,
  parseUserSpecifiedModel,
} from '../../../../src/utils/model/model.js'
import { ensureModelStringsInitialized } from '../../../../src/utils/model/modelStrings.js'
import {
  checkAndDisableBypassPermissions,
  initializeToolPermissionContext,
  initialPermissionModeFromCLI,
  isDefaultPermissionModeAuto,
  parseToolListFromCLI,
  removeDangerousPermissions,
  stripDangerousPermissionsForAutoMode,
  verifyAutoModeGateAccess,
} from '@claude-code/permission/permissionSetup'
import { cleanupOrphanedPluginVersionsInBackground } from '../../../../src/utils/plugins/cacheUtils.js'
import { initializeVersionedPlugins } from '../../../../src/utils/plugins/installedPluginsManager.js'
import { getManagedPluginNames } from '../../../../src/utils/plugins/managedPlugins.js'
import { getGlobExclusionsForPluginCache } from '../../../../src/utils/plugins/orphanedPluginFilter.js'
import { getPluginSeedDirs } from '../../../../src/utils/plugins/pluginDirectories.js'
import { countFilesRoundedRg } from '../../../../src/utils/ripgrep.js'
import {
  processSessionStartHooks,
  processSetupHooks,
} from '../../../../src/utils/sessionStart.js'
import {
  cacheSessionTitle,
  getSessionIdFromLog,
  loadTranscriptFromFile,
  saveAgentSetting,
  saveMode,
  searchSessionsByCustomTitle,
  sessionIdExists,
} from '../../../../src/utils/sessionStorage.js'
import { ensureMdmSettingsLoaded } from '../../../../src/utils/settings/mdm/settings.js'
import {
  getInitialSettings,
  getSettingsForSource,
  getSettingsWithErrors,
} from '../../../../src/utils/settings/settings.js'
import { resetSettingsCache } from '../../../../src/utils/settings/settingsCache.js'
import type { ValidationError } from '../../../../src/utils/settings/validation.js'
import {
  DEFAULT_TASKS_MODE_TASK_LIST_ID,
} from '../../../../src/utils/tasks.js'
import {
  logPluginLoadErrors,
  logPluginsEnabledForSession,
} from '../../../../src/utils/telemetry/pluginTelemetry.js'
import { logSkillsLoaded } from '../../../../src/utils/telemetry/skillLoadedEvent.js'
import { generateTempFilePath } from '../../../../src/utils/tempfile.js'
import { validateUuid } from '../../../../src/utils/uuid.js'
import { logPermissionContextForAnts } from '../../../../src/services/internalLogging.js'
import { fetchClaudeAIMcpConfigsIfEligible } from '../../../../src/services/mcp/claudeai.js'
import { clearServerCache } from '../../../../src/services/mcp/client.js'
import {
  areMcpConfigsAllowedWithEnterpriseMcpConfig,
  dedupClaudeAiMcpServers,
  doesEnterpriseMcpConfigExist,
  filterMcpServersByPolicy,
  getClaudeCodeMcpConfigs,
  getMcpServerSignature,
  parseMcpConfig,
  parseMcpConfigFromFilePath,
} from '../../../../src/services/mcp/config.js'
import {
  excludeCommandsByServer,
  excludeResourcesByServer,
} from '../../../../src/services/mcp/utils.js'
import { getRelevantTips } from '../../../../src/services/tips/tipRegistry.js'
import { logContextMetrics } from '../../../../src/utils/api.js'
import {
  CLAUDE_IN_CHROME_MCP_SERVER_NAME,
  isClaudeInChromeMCPServer,
} from '../../../../src/utils/claudeInChrome/common.js'
import { registerCleanup } from '../../../../src/utils/cleanupRegistry.js'
import { eagerParseCliFlag } from '../../../../src/utils/cliArgs.js'
import { createEmptyAttributionState } from '../../../../src/utils/commitAttribution.js'
import {
  countConcurrentSessions,
  registerSession,
  updateSessionName,
} from '../../../../src/utils/concurrentSessions.js'
import { getCwd } from '../../../../src/utils/cwd.js'
import { logForDebugging, setHasFormattedOutput } from '../../../../src/utils/debug.js'
import {
  errorMessage,
  getErrnoCode,
  isENOENT,
  TeleportOperationError,
  toError,
} from '../../../../src/utils/errors.js'
import {
  getFsImplementation,
  safeResolvePath,
} from '../../../../src/utils/fsOperations.js'
import {
  gracefulShutdown,
  gracefulShutdownSync,
} from '../../../../src/utils/gracefulShutdown.js'
import { setAllHookEventsEnabled } from '../../../../src/utils/hooks/hookEvents.js'
import { refreshModelCapabilities } from '../../../../src/utils/model/modelCapabilities.js'
import { peekForStdinData, writeToStderr } from '../../../../src/utils/process.js'
import { setCwd } from '../../../../src/utils/Shell.js'
import {
  type ProcessedResume,
  processResumedConversation,
} from '../../../../src/utils/sessionRestore.js'
import { parseSettingSourcesFlag } from '../../../../src/utils/settings/constants.js'
import { plural } from '../../../../src/utils/stringUtils.js'
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
} from '../../../../src/bootstrap/state.js'
import {
  type AppState,
  IDLE_SPECULATION_STATE,
} from '../../../../src/state/AppStateStore.js'
import { asSessionId } from '../../../../src/types/ids.js'
import { filterAllowedSdkBetas } from '../../../../src/utils/betas.js'
import { isInBundledMode, isRunningWithBun } from '../../../../src/utils/bundledMode.js'
import { logForDiagnosticsNoPII } from '../../../../src/utils/diagLogs.js'
import {
  filterExistingPaths,
  getKnownPathsForRepo,
} from '../../../../src/utils/githubRepoPathMapping.js'
import {
  clearPluginCache,
  loadAllPluginsCacheOnly,
} from '../../../../src/utils/plugins/pluginLoader.js'
import { migrateChangelogFromConfig } from '../../../../src/utils/releaseNotes.js'
import { SandboxManager } from '../../../../src/utils/sandbox/sandbox-adapter.js'
import { fetchSession, prepareApiRequest } from '../../../../src/utils/teleport/api.js'
import {
  checkOutTeleportedSessionBranch,
  processMessagesForTeleportResume,
  teleportToRemoteWithErrorHandling,
  validateGitState,
  validateSessionRepository,
} from '../../../../src/utils/teleport.js'
import {
  shouldEnableThinkingByDefault,
  type ThinkingConfig,
} from '../../../../src/utils/thinking.js'
import { initUser, resetUserCache } from '../../../../src/utils/user.js'
import {
  getTmuxInstallInstructions,
  isTmuxAvailable,
  parsePRReference,
} from '@claude-code/swarm'
import { isAnalyticsDisabled } from '../../../../src/services/privacyConfig.js'
import { profileCheckpoint } from '../../../../src/utils/startupProfiler.js'

// Types for closure variables passed as context
export type PendingConnect = {
  url: string | undefined
  authToken: string | undefined
  dangerouslySkipPermissions: boolean
}

export type PendingAssistantChat = { sessionId?: string; discover: boolean }

export type PendingSSH = {
  host: string | undefined
  cwd: string | undefined
  permissionMode: string | undefined
  dangerouslySkipPermissions: boolean
  local: boolean
  extraCliArgs: string[]
}

export type ModeDispatchContext = {
  runtimeHandles: RuntimeHandles
  pendingConnect: PendingConnect | undefined
  pendingSSH: PendingSSH | undefined
  pendingAssistantChat: PendingAssistantChat | undefined
}

// Module-level lazy requires (re-declared from main.tsx module scope)
/* eslint-disable @typescript-eslint/no-require-imports */
const getTeammateUtils = () =>
  require('../../../../src/utils/teammate.js') as typeof import('../../../../src/utils/teammate.js')
const getTeammatePromptAddendum = () =>
  require('@claude-code/swarm') as typeof import('@claude-code/swarm')
/* eslint-enable @typescript-eslint/no-require-imports */

/* eslint-disable @typescript-eslint/no-require-imports */
const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('../../../../src/coordinator/coordinatorMode.js') as typeof import('../../../../src/coordinator/coordinatorMode.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

/* eslint-disable @typescript-eslint/no-require-imports */
const assistantModule = feature('KAIROS')
  ? (require('../../../../src/assistant/index.js') as typeof import('../../../../src/assistant/index.js'))
  : null
const kairosGate = feature('KAIROS')
  ? (require('../../../../src/assistant/gate.js') as typeof import('../../../../src/assistant/gate.js'))
  : null

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../../../src/utils/permissions/autoModeState.js') as typeof import('../../../../src/utils/permissions/autoModeState.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

async function getInputPrompt(
  prompt: string,
  inputFormat: 'text' | 'stream-json',
): Promise<string | AsyncIterable<string>> {
  if (
    !process.stdin.isTTY &&
    // Input hijacking breaks MCP.
    !process.argv.includes('mcp')
  ) {
    if (inputFormat === 'stream-json') {
      return process.stdin
    }
    process.stdin.setEncoding('utf8')
    let data = ''
    const onData = (chunk: string) => {
      data += chunk
    }
    process.stdin.on('data', onData)
    // If no data arrives in 3s, stop waiting and warn. Stdin is likely an
    // inherited pipe from a parent that isn't writing (subprocess spawned
    // without explicit stdin handling). 3s covers slow producers like curl,
    // jq on large files, python with import overhead. The warning makes
    // silent data loss visible for the rare producer that's slower still.
    const timedOut = await peekForStdinData(process.stdin, 3000)
    process.stdin.off('data', onData)
    if (timedOut) {
      process.stderr.write(
        'Warning: no stdin data received in 3s, proceeding without it. ' +
          'If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.\n',
      )
    }
    return [prompt, data].filter(Boolean).join('\n')
  }
  return prompt
}

export async function runModeDispatch(
  prompt: string | undefined,
  options: Record<string, unknown>,
  ctx: ModeDispatchContext,
): Promise<void> {
  const { runtimeHandles, pendingConnect: _pendingConnect, pendingSSH: _pendingSSH, pendingAssistantChat: _pendingAssistantChat } = ctx
			profileCheckpoint("action_handler_start");

			// --bare = one-switch minimal mode. Sets SIMPLE so all the existing
			// gates fire (CLAUDE.md, skills, hooks inside executeHooks, agent
			// dir-walk). Must be set before setup() / any of the gated work runs.
			if ((options as { bare?: boolean }).bare) {
				process.env.CLAUDE_CODE_SIMPLE = "1";
			}

			// Ignore "code" as a prompt - treat it the same as no prompt
			if (prompt === "code") {
				logEvent("tengu_code_prompt_ignored", {});
				// biome-ignore lint/suspicious/noConsole:: intentional console output
				console.warn(
					chalk.yellow(
						"Tip: You can launch Claude Code with just `claude`",
					),
				);
				prompt = undefined;
			}

			// Log event for any single-word prompt
			if (
				prompt &&
				typeof prompt === "string" &&
				!/\s/.test(prompt) &&
				prompt.length > 0
			) {
				logEvent("tengu_single_word_prompt", { length: prompt.length });
			}

			// Assistant mode: when .claude/settings.json has assistant: true AND
			// the tengu_kairos GrowthBook gate is on, force brief on. Permission
			// mode is left to the user — settings defaultMode or --permission-mode
			// apply as normal. REPL-typed messages already default to 'next'
			// priority (messageQueueManager.enqueue) so they drain mid-turn between
			// tool calls. SendUserMessage (BriefTool) is enabled via the brief env
			// var. SleepTool stays disabled (its isEnabled() gates on proactive).
			// kairosEnabled is computed once here and reused at the
			// getAssistantSystemPromptAddendum() call site further down.
			//
			// Trust gate: .claude/settings.json is attacker-controllable in an
			// untrusted clone. We run ~1000 lines before showSetupScreens() shows
			// the trust dialog, and by then we've already appended
			// .claude/agents/assistant.md to the system prompt. Refuse to activate
			// until the directory has been explicitly trusted.
			let kairosEnabled = false;
			let assistantTeamContext:
				| Awaited<
						ReturnType<
							NonNullable<
								typeof assistantModule
							>["initializeAssistantTeam"]
						>
				  >
				| undefined;
			if (
				feature("KAIROS") &&
				(options as { assistant?: boolean }).assistant &&
				assistantModule
			) {
				// --assistant (Agent SDK daemon mode): force the latch before
				// isAssistantMode() runs below. The daemon has already checked
				// entitlement — don't make the child re-check tengu_kairos.
				assistantModule.markAssistantForced();
			}
			if (
				feature("KAIROS") &&
				assistantModule?.isAssistantMode() &&
				// Spawned teammates share the leader's cwd + settings.json, so
				// isAssistantMode() is true for them too. --agent-id being set
				// means we ARE a spawned teammate (extractTeammateOptions runs
				// ~170 lines later so check the raw commander option) — don't
				// re-init the team or override teammateMode/proactive/brief.
				!(options as { agentId?: unknown }).agentId &&
				kairosGate
			) {
				if (!checkHasTrustDialogAccepted()) {
					// biome-ignore lint/suspicious/noConsole:: intentional console output
					console.warn(
						chalk.yellow(
							"Assistant mode disabled: directory is not trusted. Accept the trust dialog and restart.",
						),
					);
				} else {
					// Blocking gate check — returns cached `true` instantly; if disk
					// cache is false/missing, lazily inits GrowthBook and fetches fresh
					// (max ~5s). --assistant skips the gate entirely (daemon is
					// pre-entitled).
					kairosEnabled =
						assistantModule.isAssistantForced() ||
						(await kairosGate.isKairosEnabled());
					if (kairosEnabled) {
						const opts = options as { brief?: boolean };
						opts.brief = true;
						setKairosActive(true);
						// Pre-seed an in-process team so Agent(name: "foo") spawns
						// teammates without TeamCreate. Must run BEFORE setup() captures
						// the teammateMode snapshot (initializeAssistantTeam calls
						// setCliTeammateModeOverride internally).
						assistantTeamContext =
							await assistantModule.initializeAssistantTeam();
					}
				}
			}

			const {
				debug = false,
				debugToStderr = false,
				dangerouslySkipPermissions,
				allowDangerouslySkipPermissions = false,
				tools: baseTools = [],
				allowedTools = [],
				disallowedTools = [],
				mcpConfig = [],
				permissionMode: permissionModeCli,
				addDir = [],
				fallbackModel,
				betas = [],
				ide = false,
				sessionId,
				includeHookEvents,
				includePartialMessages,
			} = options;

			if (options.prefill) {
				seedEarlyInput(options.prefill);
			}

			// Promise for file downloads - started early, awaited before REPL renders
			let fileDownloadPromise: Promise<DownloadResult[]> | undefined;

			const agentsJson = options.agents;
			const agentCli = options.agent;
			if (feature("BG_SESSIONS") && agentCli) {
				process.env.CLAUDE_CODE_AGENT = agentCli;
			}

			// NOTE: LSP manager initialization is intentionally deferred until after
			// the trust dialog is accepted. This prevents plugin LSP servers from
			// executing code in untrusted directories before user consent.

			// Extract these separately so they can be modified if needed
			let outputFormat = options.outputFormat;
			let inputFormat = options.inputFormat;
			let verbose = options.verbose ?? getGlobalConfig().verbose;
			let print = options.print;
			const init = options.init ?? false;
			const initOnly = options.initOnly ?? false;
			const maintenance = options.maintenance ?? false;

			// Extract disable slash commands flag
			const disableSlashCommands = options.disableSlashCommands || false;

			// Extract tasks mode options (ant-only)
			const tasksOption =
				process.env.USER_TYPE === "ant" &&
				(options as { tasks?: boolean | string }).tasks;
			const taskListId = tasksOption
				? typeof tasksOption === "string"
					? tasksOption
					: DEFAULT_TASKS_MODE_TASK_LIST_ID
				: undefined;
			if (process.env.USER_TYPE === "ant" && taskListId) {
				process.env.CLAUDE_CODE_TASK_LIST_ID = taskListId;
			}

			// Extract worktree option
			// worktree can be true (flag without value) or a string (custom name or PR reference)
			const worktreeOption = isWorktreeModeEnabled()
				? (options as { worktree?: boolean | string }).worktree
				: undefined;
			let worktreeName =
				typeof worktreeOption === "string" ? worktreeOption : undefined;
			const worktreeEnabled = worktreeOption !== undefined;

			// Check if worktree name is a PR reference (#N or GitHub PR URL)
			let worktreePRNumber: number | undefined;
			if (worktreeName) {
				const prNum = parsePRReference(worktreeName);
				if (prNum !== null) {
					worktreePRNumber = prNum;
					worktreeName = undefined; // slug will be generated in setup()
				}
			}

			// Extract tmux option (requires --worktree)
			const tmuxEnabled =
				isWorktreeModeEnabled() &&
				(options as { tmux?: boolean }).tmux === true;

			// Validate tmux option
			if (tmuxEnabled) {
				if (!worktreeEnabled) {
					process.stderr.write(
						chalk.red("Error: --tmux requires --worktree\n"),
					);
					process.exit(1);
				}
				if (getPlatform() === "windows") {
					process.stderr.write(
						chalk.red(
							"Error: --tmux is not supported on Windows\n",
						),
					);
					process.exit(1);
				}
				if (!(await isTmuxAvailable())) {
					process.stderr.write(
						chalk.red(
							`Error: tmux is not installed.\n${getTmuxInstallInstructions()}\n`,
						),
					);
					process.exit(1);
				}
			}

			// Extract teammate options (for tmux-spawned agents)
			// Declared outside the if block so it's accessible later for system prompt addendum
			let storedTeammateOpts: TeammateOptions | undefined;
			if (isAgentSwarmsEnabled()) {
				// Extract agent identity options (for tmux-spawned agents)
				// These replace the CLAUDE_CODE_* environment variables
				const teammateOpts = extractTeammateOptions(options);
				storedTeammateOpts = teammateOpts;

				// If any teammate identity option is provided, all three required ones must be present
				const hasAnyTeammateOpt =
					teammateOpts.agentId ||
					teammateOpts.agentName ||
					teammateOpts.teamName;
				const hasAllRequiredTeammateOpts =
					teammateOpts.agentId &&
					teammateOpts.agentName &&
					teammateOpts.teamName;

				if (hasAnyTeammateOpt && !hasAllRequiredTeammateOpts) {
					process.stderr.write(
						chalk.red(
							"Error: --agent-id, --agent-name, and --team-name must all be provided together\n",
						),
					);
					process.exit(1);
				}

				// If teammate identity is provided via CLI, set up dynamicTeamContext
				if (
					teammateOpts.agentId &&
					teammateOpts.agentName &&
					teammateOpts.teamName
				) {
					getTeammateUtils().setDynamicTeamContext?.({
						agentId: teammateOpts.agentId,
						agentName: teammateOpts.agentName,
						teamName: teammateOpts.teamName,
						color: teammateOpts.agentColor,
						planModeRequired:
							teammateOpts.planModeRequired ?? false,
						parentSessionId: teammateOpts.parentSessionId,
					});
				}

				// Set teammate mode CLI override if provided
				// This must be done before setup() captures the snapshot
				if (teammateOpts.teammateMode) {
					getTeammateModeSnapshot().setCliTeammateModeOverride?.(
						teammateOpts.teammateMode,
					);
				}
			}

			// Extract remote sdk options
			const sdkUrl = (options as { sdkUrl?: string }).sdkUrl ?? undefined;

			// Allow env var to enable partial messages (used by sandbox gateway for baku)
			const effectiveIncludePartialMessages =
				includePartialMessages ||
				isEnvTruthy(process.env.CLAUDE_CODE_INCLUDE_PARTIAL_MESSAGES);

			// Enable all hook event types when explicitly requested via SDK option
			// or when running in CLAUDE_CODE_REMOTE mode (CCR needs them).
			// Without this, only SessionStart and Setup events are emitted.
			if (
				includeHookEvents ||
				isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
			) {
				setAllHookEventsEnabled(true);
			}

			// Auto-set input/output formats, verbose mode, and print mode when SDK URL is provided
			if (sdkUrl) {
				// If SDK URL is provided, automatically use stream-json formats unless explicitly set
				if (!inputFormat) {
					inputFormat = "stream-json";
				}
				if (!outputFormat) {
					outputFormat = "stream-json";
				}
				// Auto-enable verbose mode unless explicitly disabled or already set
				if (options.verbose === undefined) {
					verbose = true;
				}
				// Auto-enable print mode unless explicitly disabled
				if (!options.print) {
					print = true;
				}
			}

			// Extract teleport option
			const teleport =
				(options as { teleport?: string | true }).teleport ?? null;

			// Extract remote option (can be true if no description provided, or a string)
			const remoteOption = (options as { remote?: string | true }).remote;
			const remote = remoteOption === true ? "" : (remoteOption ?? null);

			// Extract --remote-control / --rc flag (enable bridge in interactive session)
			const remoteControlOption =
				(options as { remoteControl?: string | true }).remoteControl ??
				(options as { rc?: string | true }).rc;
			// Actual bridge check is deferred to after showSetupScreens() so that
			// trust is established and GrowthBook has auth headers.
			let remoteControl = false;
			const remoteControlName =
				typeof remoteControlOption === "string" &&
				remoteControlOption.length > 0
					? remoteControlOption
					: undefined;

			// Validate session ID if provided
			if (sessionId) {
				// Check for conflicting flags
				// --session-id can be used with --continue or --resume when --fork-session is also provided
				// (to specify a custom ID for the forked session)
				if (
					(options.continue || options.resume) &&
					!options.forkSession
				) {
					process.stderr.write(
						chalk.red(
							"Error: --session-id can only be used with --continue or --resume if --fork-session is also specified.\n",
						),
					);
					process.exit(1);
				}

				// When --sdk-url is provided (bridge/remote mode), the session ID is a
				// server-assigned tagged ID (e.g. "session_local_01...") rather than a
				// UUID. Skip UUID validation and local existence checks in that case.
				if (!sdkUrl) {
					const validatedSessionId = validateUuid(sessionId);
					if (!validatedSessionId) {
						process.stderr.write(
							chalk.red(
								"Error: Invalid session ID. Must be a valid UUID.\n",
							),
						);
						process.exit(1);
					}

					// Check if session ID already exists
					if (sessionIdExists(validatedSessionId)) {
						process.stderr.write(
							chalk.red(
								`Error: Session ID ${validatedSessionId} is already in use.\n`,
							),
						);
						process.exit(1);
					}
				}
			}

			// Download file resources if specified via --file flag
			const fileSpecs = (options as { file?: string[] }).file;
			if (fileSpecs && fileSpecs.length > 0) {
				// Get session ingress token (provided by EnvManager via CLAUDE_CODE_SESSION_ACCESS_TOKEN)
				const sessionToken = getSessionIngressAuthToken();
				if (!sessionToken) {
					process.stderr.write(
						chalk.red(
							"Error: Session token required for file downloads. CLAUDE_CODE_SESSION_ACCESS_TOKEN must be set.\n",
						),
					);
					process.exit(1);
				}

				// Resolve session ID: prefer remote session ID, fall back to internal session ID
				const fileSessionId =
					process.env.CLAUDE_CODE_REMOTE_SESSION_ID || getSessionId();

				const files = parseFileSpecs(fileSpecs);
				if (files.length > 0) {
					// Use ANTHROPIC_BASE_URL if set (by EnvManager), otherwise use OAuth config
					// This ensures consistency with session ingress API in all environments
					const config: FilesApiConfig = {
						baseUrl:
							process.env.ANTHROPIC_BASE_URL ||
							getOauthConfig().BASE_API_URL,
						oauthToken: sessionToken,
						sessionId: fileSessionId,
					};

					// Start download without blocking startup - await before REPL renders
					fileDownloadPromise = downloadSessionFiles(files, config);
				}
			}

			// Get isNonInteractiveSession from state (was set before init())
			const isNonInteractiveSession = getIsNonInteractiveSession();

			// Validate that fallback model is different from main model
			if (
				fallbackModel &&
				options.model &&
				fallbackModel === options.model
			) {
				process.stderr.write(
					chalk.red(
						"Error: Fallback model cannot be the same as the main model. Please specify a different model for --fallback-model.\n",
					),
				);
				process.exit(1);
			}

			// Handle system prompt options
			let systemPrompt = options.systemPrompt;
			if (options.systemPromptFile) {
				if (options.systemPrompt) {
					process.stderr.write(
						chalk.red(
							"Error: Cannot use both --system-prompt and --system-prompt-file. Please use only one.\n",
						),
					);
					process.exit(1);
				}

				try {
					const filePath = resolve(options.systemPromptFile);
					systemPrompt = readFileSync(filePath, "utf8");
				} catch (error) {
					const code = getErrnoCode(error);
					if (code === "ENOENT") {
						process.stderr.write(
							chalk.red(
								`Error: System prompt file not found: ${resolve(options.systemPromptFile)}\n`,
							),
						);
						process.exit(1);
					}
					process.stderr.write(
						chalk.red(
							`Error reading system prompt file: ${errorMessage(error)}\n`,
						),
					);
					process.exit(1);
				}
			}

			// Handle append system prompt options
			let appendSystemPrompt = options.appendSystemPrompt;
			if (options.appendSystemPromptFile) {
				if (options.appendSystemPrompt) {
					process.stderr.write(
						chalk.red(
							"Error: Cannot use both --append-system-prompt and --append-system-prompt-file. Please use only one.\n",
						),
					);
					process.exit(1);
				}

				try {
					const filePath = resolve(options.appendSystemPromptFile);
					appendSystemPrompt = readFileSync(filePath, "utf8");
				} catch (error) {
					const code = getErrnoCode(error);
					if (code === "ENOENT") {
						process.stderr.write(
							chalk.red(
								`Error: Append system prompt file not found: ${resolve(options.appendSystemPromptFile)}\n`,
							),
						);
						process.exit(1);
					}
					process.stderr.write(
						chalk.red(
							`Error reading append system prompt file: ${errorMessage(error)}\n`,
						),
					);
					process.exit(1);
				}
			}

			// Add teammate-specific system prompt addendum for tmux teammates
			if (
				isAgentSwarmsEnabled() &&
				storedTeammateOpts?.agentId &&
				storedTeammateOpts?.agentName &&
				storedTeammateOpts?.teamName
			) {
				const addendum =
					getTeammatePromptAddendum().TEAMMATE_SYSTEM_PROMPT_ADDENDUM;
				appendSystemPrompt = appendSystemPrompt
					? `${appendSystemPrompt}\n\n${addendum}`
					: addendum;
			}

			const {
				mode: permissionMode,
				notification: permissionModeNotification,
			} = initialPermissionModeFromCLI({
				permissionModeCli,
				dangerouslySkipPermissions,
			});

			// Store session bypass permissions mode for trust dialog check
			setSessionBypassPermissionsMode(
				permissionMode === "bypassPermissions",
			);
			if (feature("TRANSCRIPT_CLASSIFIER")) {
				// autoModeFlagCli is the "did the user intend auto this session" signal.
				// Set when: --enable-auto-mode, --permission-mode auto, resolved mode
				// is auto, OR settings defaultMode is auto but the gate denied it
				// (permissionMode resolved to default with no explicit CLI override).
				// Used by verifyAutoModeGateAccess to decide whether to notify on
				// auto-unavailable, and by tengu_auto_mode_config opt-in carousel.
				if (
					(options as { enableAutoMode?: boolean }).enableAutoMode ||
					permissionModeCli === "auto" ||
					permissionMode === "auto" ||
					(!permissionModeCli && isDefaultPermissionModeAuto())
				) {
					autoModeStateModule?.setAutoModeFlagCli(true);
				}
			}

			// Parse the MCP config files/strings if provided
			let dynamicMcpConfig: Record<string, ScopedMcpServerConfig> = {};

			if (mcpConfig && mcpConfig.length > 0) {
				// Process mcpConfig array
				const processedConfigs = mcpConfig
					.map((config) => config.trim())
					.filter((config) => config.length > 0);

				let allConfigs: Record<string, McpServerConfig> = {};
				const allErrors: ValidationError[] = [];

				for (const configItem of processedConfigs) {
					let configs: Record<string, McpServerConfig> | null = null;
					let errors: ValidationError[] = [];

					// First try to parse as JSON string
					const parsedJson = safeParseJSON(configItem);
					if (parsedJson) {
						const result = parseMcpConfig({
							configObject: parsedJson,
							filePath: "command line",
							expandVars: true,
							scope: "dynamic",
						});
						if (result.config) {
							configs = result.config.mcpServers;
						} else {
							errors = result.errors;
						}
					} else {
						// Try as file path
						const configPath = resolve(configItem);
						const result = parseMcpConfigFromFilePath({
							filePath: configPath,
							expandVars: true,
							scope: "dynamic",
						});
						if (result.config) {
							configs = result.config.mcpServers;
						} else {
							errors = result.errors;
						}
					}

					if (errors.length > 0) {
						allErrors.push(...errors);
					} else if (configs) {
						// Merge configs, later ones override earlier ones
						allConfigs = { ...allConfigs, ...configs };
					}
				}

				if (allErrors.length > 0) {
					const formattedErrors = allErrors
						.map(
							(err) =>
								`${err.path ? err.path + ": " : ""}${err.message}`,
						)
						.join("\n");
					logForDebugging(
						`--mcp-config validation failed (${allErrors.length} errors): ${formattedErrors}`,
						{
							level: "error",
						},
					);
					process.stderr.write(
						`Error: Invalid MCP configuration:\n${formattedErrors}\n`,
					);
					process.exit(1);
				}

				if (Object.keys(allConfigs).length > 0) {
					// SDK hosts (Nest/Desktop) own their server naming and may reuse
					// built-in names — skip reserved-name checks for type:'sdk'.
					const nonSdkConfigNames = Object.entries(allConfigs)
						.filter(([, config]) => config.type !== "sdk")
						.map(([name]) => name);

					let reservedNameError: string | null = null;
					if (nonSdkConfigNames.some(isClaudeInChromeMCPServer)) {
						reservedNameError = `Invalid MCP configuration: "${CLAUDE_IN_CHROME_MCP_SERVER_NAME}" is a reserved MCP name.`;
					} else if (feature("CHICAGO_MCP")) {
						const {
							isComputerUseMCPServer,
							COMPUTER_USE_MCP_SERVER_NAME,
						} = await import("../../../../src/utils/computerUse/common.js");
						if (nonSdkConfigNames.some(isComputerUseMCPServer)) {
							reservedNameError = `Invalid MCP configuration: "${COMPUTER_USE_MCP_SERVER_NAME}" is a reserved MCP name.`;
						}
					}
					if (reservedNameError) {
						// stderr+exit(1) — a throw here becomes a silent unhandled
						// rejection in stream-json mode (void main() in cli.tsx).
						process.stderr.write(`Error: ${reservedNameError}\n`);
						process.exit(1);
					}

					// Add dynamic scope to all configs. type:'sdk' entries pass through
					// unchanged — they're extracted into sdkMcpConfigs downstream and
					// passed to print.ts. The Python SDK relies on this path (it doesn't
					// send sdkMcpServers in the initialize message). Dropping them here
					// broke Coworker (inc-5122). The policy filter below already exempts
					// type:'sdk', and the entries are inert without an SDK transport on
					// stdin, so there's no bypass risk from letting them through.
					const scopedConfigs = mapValues(allConfigs, (config) => ({
						...config,
						scope: "dynamic" as const,
					}));

					// Enforce managed policy (allowedMcpServers / deniedMcpServers) on
					// --mcp-config servers. Without this, the CLI flag bypasses the
					// enterprise allowlist that user/project/local configs go through in
					// getClaudeCodeMcpConfigs — callers spread dynamicMcpConfig back on
					// top of filtered results. Filter here at the source so all
					// downstream consumers see the policy-filtered set.
					const { allowed, blocked } =
						filterMcpServersByPolicy(scopedConfigs);
					if (blocked.length > 0) {
						process.stderr.write(
							`Warning: MCP ${plural(blocked.length, "server")} blocked by enterprise policy: ${blocked.join(", ")}\n`,
						);
					}
					dynamicMcpConfig = { ...dynamicMcpConfig, ...allowed };
				}
			}

			// Extract Claude in Chrome option and enforce claude.ai subscriber check (unless user is ant)
			const chromeOpts = options as { chrome?: boolean };
			// Store the explicit CLI flag so teammates can inherit it
			setChromeFlagOverride(chromeOpts.chrome);
			const enableClaudeInChrome =
				shouldEnableClaudeInChrome(chromeOpts.chrome) &&
				(process.env.USER_TYPE === "ant" || isClaudeAISubscriber());
			const autoEnableClaudeInChrome =
				!enableClaudeInChrome && shouldAutoEnableClaudeInChrome();

			if (enableClaudeInChrome) {
				const platform = getPlatform();
				try {
					logEvent("tengu_claude_in_chrome_setup", {
						platform:
							platform as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
					});

					const {
						mcpConfig: chromeMcpConfig,
						allowedTools: chromeMcpTools,
						systemPrompt: chromeSystemPrompt,
					} = setupClaudeInChrome();
					dynamicMcpConfig = {
						...dynamicMcpConfig,
						...chromeMcpConfig,
					};
					allowedTools.push(...chromeMcpTools);
					if (chromeSystemPrompt) {
						appendSystemPrompt = appendSystemPrompt
							? `${chromeSystemPrompt}\n\n${appendSystemPrompt}`
							: chromeSystemPrompt;
					}
				} catch (error) {
					logEvent("tengu_claude_in_chrome_setup_failed", {
						platform:
							platform as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
					});
					logForDebugging(`[Claude in Chrome] Error: ${error}`);
					logError(error);
					// biome-ignore lint/suspicious/noConsole:: intentional console output
					console.error(
						`Error: Failed to run with Claude in Chrome.`,
					);
					process.exit(1);
				}
			} else if (autoEnableClaudeInChrome) {
				try {
					const { mcpConfig: chromeMcpConfig } =
						setupClaudeInChrome();
					dynamicMcpConfig = {
						...dynamicMcpConfig,
						...chromeMcpConfig,
					};

					const hint =
						feature("WEB_BROWSER_TOOL") &&
						typeof Bun !== "undefined" &&
						"WebView" in Bun
							? CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER
							: CLAUDE_IN_CHROME_SKILL_HINT;
					appendSystemPrompt = appendSystemPrompt
						? `${appendSystemPrompt}\n\n${hint}`
						: hint;
				} catch (error) {
					// Silently skip any errors for the auto-enable
					logForDebugging(
						`[Claude in Chrome] Error (auto-enable): ${error}`,
					);
				}
			}

			// Extract strict MCP config flag
			const strictMcpConfig = options.strictMcpConfig || false;

			// Check if enterprise MCP configuration exists. When it does, only allow dynamic MCP
			// configs that contain special server types (sdk)
			if (doesEnterpriseMcpConfigExist()) {
				if (strictMcpConfig) {
					process.stderr.write(
						chalk.red(
							"You cannot use --strict-mcp-config when an enterprise MCP config is present",
						),
					);
					process.exit(1);
				}

				// For --mcp-config, allow if all servers are internal types (sdk)
				if (
					dynamicMcpConfig &&
					!areMcpConfigsAllowedWithEnterpriseMcpConfig(
						dynamicMcpConfig,
					)
				) {
					process.stderr.write(
						chalk.red(
							"You cannot dynamically configure MCP servers when an enterprise MCP config is present",
						),
					);
					process.exit(1);
				}
			}

			// chicago MCP: guarded Computer Use (app allowlist + frontmost gate +
			// SCContentFilter screenshots). Ant-only, GrowthBook-gated — failures
			// are silent (this is dogfooding). Platform + interactive checks inline
			// so non-macOS / print-mode ants skip the heavy @ant/computer-use-mcp
			// import entirely. gates.js is light (type-only package import).
			//
			// Placed AFTER the enterprise-MCP-config check: that check rejects any
			// dynamicMcpConfig entry with `type !== 'sdk'`, and our config is
			// `type: 'stdio'`. An enterprise-config ant with the GB gate on would
			// otherwise process.exit(1). Chrome has the same latent issue but has
			// shipped without incident; chicago places itself correctly.
			if (
				feature("CHICAGO_MCP") &&
				getPlatform() !== "unknown" &&
				!getIsNonInteractiveSession()
			) {
				try {
					const { getChicagoEnabled } =
						await import("../../../../src/utils/computerUse/gates.js");
					if (getChicagoEnabled()) {
						const { setupComputerUseMCP } =
							await import("../../../../src/utils/computerUse/setup.js");
						const { mcpConfig, allowedTools: cuTools } =
							setupComputerUseMCP();
						dynamicMcpConfig = {
							...dynamicMcpConfig,
							...mcpConfig,
						};
						allowedTools.push(...cuTools);
					}
				} catch (error) {
					logForDebugging(
						`[Computer Use MCP] Setup failed: ${errorMessage(error)}`,
					);
				}
			}

			// Store additional directories for CLAUDE.md loading (controlled by env var)
			setAdditionalDirectoriesForClaudeMd(addDir);

			// Channel server allowlist from --channels flag — servers whose
			// inbound push notifications should register this session. The option
			// is added inside a feature() block so TS doesn't know about it
			// on the options type — same pattern as --assistant at main.tsx:1824.
			// devChannels is deferred: showSetupScreens shows a confirmation dialog
			// and only appends to allowedChannels on accept.
			let devChannels: ChannelEntry[] | undefined;
			if (feature("KAIROS") || feature("KAIROS_CHANNELS")) {
				// Parse plugin:name@marketplace / server:Y tags into typed entries.
				// Tag decides trust model downstream: plugin-kind hits marketplace
				// verification + GrowthBook allowlist, server-kind always fails
				// allowlist (schema is plugin-only) unless dev flag is set.
				// Untagged or marketplace-less plugin entries are hard errors —
				// silently not-matching in the gate would look like channels are
				// "on" but nothing ever fires.
				const parseChannelEntries = (
					raw: string[],
					flag: string,
				): ChannelEntry[] => {
					const entries: ChannelEntry[] = [];
					const bad: string[] = [];
					for (const c of raw) {
						if (c.startsWith("plugin:")) {
							const rest = c.slice(7);
							const at = rest.indexOf("@");
							if (at <= 0 || at === rest.length - 1) {
								bad.push(c);
							} else {
								entries.push({
									kind: "plugin",
									name: rest.slice(0, at),
									marketplace: rest.slice(at + 1),
								});
							}
						} else if (c.startsWith("server:") && c.length > 7) {
							entries.push({ kind: "server", name: c.slice(7) });
						} else {
							bad.push(c);
						}
					}
					if (bad.length > 0) {
						process.stderr.write(
							chalk.red(
								`${flag} entries must be tagged: ${bad.join(", ")}\n` +
									`  plugin:<name>@<marketplace>  — plugin-provided channel (allowlist enforced)\n` +
									`  server:<name>                — manually configured MCP server\n`,
							),
						);
						process.exit(1);
					}
					return entries;
				};

				const channelOpts = options as {
					channels?: string[];
					dangerouslyLoadDevelopmentChannels?: string[];
				};
				const rawChannels = channelOpts.channels;
				const rawDev = channelOpts.dangerouslyLoadDevelopmentChannels;
				// Always parse + set. ChannelsNotice reads getAllowedChannels() and
				// renders the appropriate branch (disabled/noAuth/policyBlocked/
				// listening) in the startup screen. gateChannelServer() enforces.
				// --channels works in both interactive and print/SDK modes; dev-channels
				// stays interactive-only (requires a confirmation dialog).
				let channelEntries: ChannelEntry[] = [];
				if (rawChannels && rawChannels.length > 0) {
					channelEntries = parseChannelEntries(
						rawChannels,
						"--channels",
					);
					setAllowedChannels(channelEntries);
				}
				if (!isNonInteractiveSession) {
					if (rawDev && rawDev.length > 0) {
						devChannels = parseChannelEntries(
							rawDev,
							"--dangerously-load-development-channels",
						);
					}
				}
				// Flag-usage telemetry. Plugin identifiers are logged (same tier as
				// tengu_plugin_installed — public-registry-style names); server-kind
				// names are not (MCP-server-name tier, opt-in-only elsewhere).
				// Per-server gate outcomes land in tengu_mcp_channel_gate once
				// servers connect. Dev entries go through a confirmation dialog after
				// this — dev_plugins captures what was typed, not what was accepted.
				if (
					channelEntries.length > 0 ||
					(devChannels?.length ?? 0) > 0
				) {
					const joinPluginIds = (entries: ChannelEntry[]) => {
						const ids = entries.flatMap((e) =>
							e.kind === "plugin"
								? [`${e.name}@${e.marketplace}`]
								: [],
						);
						return ids.length > 0
							? (ids
									.sort()
									.join(
										",",
									) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
							: undefined;
					};
					logEvent("tengu_mcp_channel_flags", {
						channels_count: channelEntries.length,
						dev_count: devChannels?.length ?? 0,
						plugins: joinPluginIds(channelEntries),
						dev_plugins: joinPluginIds(devChannels ?? []),
					});
				}
			}

			// SDK opt-in for SendUserMessage via --tools. All sessions require
			// explicit opt-in; listing it in --tools signals intent. Runs BEFORE
			// initializeToolPermissionContext so getToolsForDefaultPreset() sees
			// the tool as enabled when computing the base-tools disallow filter.
			// Conditional require avoids leaking the tool-name string into
			// external builds.
			if (
				(feature("KAIROS") || feature("KAIROS_BRIEF")) &&
				baseTools.length > 0
			) {
				/* eslint-disable @typescript-eslint/no-require-imports */
				const { BRIEF_TOOL_NAME, LEGACY_BRIEF_TOOL_NAME } =
					require("../../../../src/tools/BriefTool/prompt.js") as typeof import("../../../../src/tools/BriefTool/prompt.js");
				const { isBriefEntitled } =
					require("../../../../src/tools/BriefTool/BriefTool.js") as typeof import("../../../../src/tools/BriefTool/BriefTool.js");
				/* eslint-enable @typescript-eslint/no-require-imports */
				const parsed = parseToolListFromCLI(baseTools);
				if (
					(parsed.includes(BRIEF_TOOL_NAME) ||
						parsed.includes(LEGACY_BRIEF_TOOL_NAME)) &&
					isBriefEntitled()
				) {
					setUserMsgOptIn(true);
				}
			}

			// This await replaces blocking existsSync/statSync calls that were already in
			// the startup path. Wall-clock time is unchanged; we just yield to the event
			// loop during the fs I/O instead of blocking it. See #19661.
			const initResult = await initializeToolPermissionContext({
				allowedToolsCli: allowedTools,
				disallowedToolsCli: disallowedTools,
				baseToolsCli: baseTools,
				permissionMode,
				allowDangerouslySkipPermissions,
				addDirs: addDir,
			});
			let toolPermissionContext = initResult.toolPermissionContext;
			const {
				warnings,
				dangerousPermissions,
				overlyBroadBashPermissions,
			} = initResult;

			// Handle overly broad shell allow rules for ant users (Bash(*), PowerShell(*))
			if (
				process.env.USER_TYPE === "ant" &&
				overlyBroadBashPermissions.length > 0
			) {
				for (const permission of overlyBroadBashPermissions) {
					logForDebugging(
						`Ignoring overly broad shell permission ${permission.ruleDisplay} from ${permission.sourceDisplay}`,
					);
				}
				toolPermissionContext = removeDangerousPermissions(
					toolPermissionContext,
					overlyBroadBashPermissions,
				);
			}

			if (
				feature("TRANSCRIPT_CLASSIFIER") &&
				dangerousPermissions.length > 0
			) {
				toolPermissionContext = stripDangerousPermissionsForAutoMode(
					toolPermissionContext,
				);
			}

			// Print any warnings from initialization
			warnings.forEach((warning) => {
				// biome-ignore lint/suspicious/noConsole:: intentional console output
				console.error(warning);
			});


			// claude.ai config fetch: -p mode only (interactive uses useManageMCPConnections
			// two-phase loading). Kicked off here to overlap with setup(); awaited
			// before runHeadless so single-turn -p sees connectors. Skipped under
			// enterprise/strict MCP to preserve policy boundaries.
			const claudeaiConfigPromise: Promise<
				Record<string, ScopedMcpServerConfig>
			> =
				isNonInteractiveSession &&
				!strictMcpConfig &&
				!doesEnterpriseMcpConfigExist() &&
				// --bare / SIMPLE: skip claude.ai proxy servers (datadog, Gmail,
				// Slack, BigQuery, PubMed — 6-14s each to connect). Scripted calls
				// that need MCP pass --mcp-config explicitly.
				!isBareMode()
					? fetchClaudeAIMcpConfigsIfEligible().then((configs) => {
							const { allowed, blocked } =
								filterMcpServersByPolicy(configs);
							if (blocked.length > 0) {
								process.stderr.write(
									`Warning: claude.ai MCP ${plural(blocked.length, "server")} blocked by enterprise policy: ${blocked.join(", ")}\n`,
								);
							}
							return allowed;
						})
					: Promise.resolve({});

			// Kick off MCP config loading early (safe - just reads files, no execution).
			// Both interactive and -p use getClaudeCodeMcpConfigs (local file reads only).
			// The local promise is awaited later (before prefetchAllMcpResources) to
			// overlap config I/O with setup(), commands loading, and trust dialog.
			logForDebugging("[STARTUP] Loading MCP configs...");
			const mcpConfigStart = Date.now();
			let mcpConfigResolvedMs: number | undefined;
			// --bare skips auto-discovered MCP (.mcp.json, user settings, plugins) —
			// only explicit --mcp-config works. dynamicMcpConfig is spread onto
			// allMcpConfigs downstream so it survives this skip.
			const mcpConfigPromise = (
				strictMcpConfig || isBareMode()
					? Promise.resolve({
							servers: {} as Record<
								string,
								ScopedMcpServerConfig
							>,
						})
					: getClaudeCodeMcpConfigs(dynamicMcpConfig)
			).then((result) => {
				mcpConfigResolvedMs = Date.now() - mcpConfigStart;
				return result;
			});

			// NOTE: We do NOT call prefetchAllMcpResources here - that's deferred until after trust dialog

			if (
				inputFormat &&
				inputFormat !== "text" &&
				inputFormat !== "stream-json"
			) {
				// biome-ignore lint/suspicious/noConsole:: intentional console output
				console.error(`Error: Invalid input format "${inputFormat}".`);
				process.exit(1);
			}
			if (
				inputFormat === "stream-json" &&
				outputFormat !== "stream-json"
			) {
				// biome-ignore lint/suspicious/noConsole:: intentional console output
				console.error(
					`Error: --input-format=stream-json requires output-format=stream-json.`,
				);
				process.exit(1);
			}

			// Validate sdkUrl is only used with appropriate formats (formats are auto-set above)
			if (sdkUrl) {
				if (
					inputFormat !== "stream-json" ||
					outputFormat !== "stream-json"
				) {
					// biome-ignore lint/suspicious/noConsole:: intentional console output
					console.error(
						`Error: --sdk-url requires both --input-format=stream-json and --output-format=stream-json.`,
					);
					process.exit(1);
				}
			}

			// Validate replayUserMessages is only used with stream-json formats
			if (options.replayUserMessages) {
				if (
					inputFormat !== "stream-json" ||
					outputFormat !== "stream-json"
				) {
					// biome-ignore lint/suspicious/noConsole:: intentional console output
					console.error(
						`Error: --replay-user-messages requires both --input-format=stream-json and --output-format=stream-json.`,
					);
					process.exit(1);
				}
			}

			// Validate includePartialMessages is only used with print mode and stream-json output
			if (effectiveIncludePartialMessages) {
				if (
					!isNonInteractiveSession ||
					outputFormat !== "stream-json"
				) {
					writeToStderr(
						`Error: --include-partial-messages requires --print and --output-format=stream-json.`,
					);
					process.exit(1);
				}
			}

			// Validate --no-session-persistence is only used with print mode
			if (
				options.sessionPersistence === false &&
				!isNonInteractiveSession
			) {
				writeToStderr(
					`Error: --no-session-persistence can only be used with --print mode.`,
				);
				process.exit(1);
			}

			const effectivePrompt = prompt || "";
			let inputPrompt = await getInputPrompt(
				effectivePrompt,
				(inputFormat ?? "text") as "text" | "stream-json",
			);
			profileCheckpoint("action_after_input_prompt");

			// Activate proactive mode BEFORE getTools() so SleepTool.isEnabled()
			// (which returns isProactiveActive()) passes and Sleep is included.
			// The later REPL-path maybeActivateProactive() calls are idempotent.
			maybeActivateProactive(options);

			let tools = getTools(toolPermissionContext);

			// Apply coordinator mode tool filtering for headless path
			// (mirrors useMergedTools.ts filtering for REPL/interactive path)
			if (
				feature("COORDINATOR_MODE") &&
				isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)
			) {
				const { applyCoordinatorToolFilter } =
					await import("../../../../src/utils/toolPool.js");
				tools = applyCoordinatorToolFilter(tools);
			}

			profileCheckpoint("action_tools_loaded");

			let jsonSchema: ToolInputJSONSchema | undefined;
			if (
				isSyntheticOutputToolEnabled({ isNonInteractiveSession }) &&
				options.jsonSchema
			) {
				jsonSchema = jsonParse(
					options.jsonSchema,
				) as ToolInputJSONSchema;
			}

			if (jsonSchema) {
				const syntheticOutputResult =
					createSyntheticOutputTool(jsonSchema);
				if ("tool" in syntheticOutputResult) {
					// Add SyntheticOutputTool to the tools array AFTER getTools() filtering.
					// This tool is excluded from normal filtering (see tools.ts) because it's
					// an implementation detail for structured output, not a user-controlled tool.
					tools = [...tools, syntheticOutputResult.tool];

					logEvent("tengu_structured_output_enabled", {
						schema_property_count: Object.keys(
							(jsonSchema.properties as Record<
								string,
								unknown
							>) || {},
						)
							.length as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
						has_required_fields: Boolean(
							jsonSchema.required,
						) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
					});
				} else {
					logEvent("tengu_structured_output_failure", {
						error: "Invalid JSON schema" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
					});
				}
			}

			// IMPORTANT: setup() must be called before any other code that depends on the cwd or worktree setup
			profileCheckpoint("action_before_setup");
			logForDebugging("[STARTUP] Running setup()...");
			const setupStart = Date.now();
			const { setup } = await import("../../../../src/setup.js");
			const messagingSocketPath = feature("UDS_INBOX")
				? (options as { messagingSocketPath?: string })
						.messagingSocketPath
				: undefined;
			// Parallelize setup() with commands+agents loading. setup()'s ~28ms is
			// mostly startUdsMessaging (socket bind, ~20ms) — not disk-bound, so it
			// doesn't contend with getCommands' file reads. Gated on !worktreeEnabled
			// since --worktree makes setup() process.chdir() (setup.ts:203), and
			// commands/agents need the post-chdir cwd.
			const preSetupCwd = getCwd();
			// Register bundled skills/plugins before kicking getCommands() — they're
			// pure in-memory array pushes (<1ms, zero I/O) that getBundledSkills()
			// reads synchronously. Previously ran inside setup() after ~20ms of
			// await points, so the parallel getCommands() memoized an empty list.
			if (process.env.CLAUDE_CODE_ENTRYPOINT !== "local-agent") {
				initBuiltinPlugins();
				initBundledSkills();
			}
			const setupPromise = setup(
				preSetupCwd,
				permissionMode,
				allowDangerouslySkipPermissions,
				worktreeEnabled,
				worktreeName,
				tmuxEnabled,
				sessionId ? validateUuid(sessionId) : undefined,
				worktreePRNumber,
				messagingSocketPath,
			);
			const commandsPromise = worktreeEnabled
				? null
				: getCommands(preSetupCwd);
			const agentDefsPromise = worktreeEnabled
				? null
				: getAgentDefinitionsWithOverrides(preSetupCwd);
			// Suppress transient unhandledRejection if these reject during the
			// ~28ms setupPromise await before Promise.all joins them below.
			commandsPromise?.catch(() => {});
			agentDefsPromise?.catch(() => {});
			await setupPromise;
			logForDebugging(
				`[STARTUP] setup() completed in ${Date.now() - setupStart}ms`,
			);
			profileCheckpoint("action_after_setup");

			// Replay user messages into stream-json only when the socket was
			// explicitly requested. The auto-generated socket is passive — it
			// lets tools inject if they want to, but turning it on by default
			// shouldn't reshape stream-json for SDK consumers who never touch it.
			// Callers who inject and also want those injections visible in the
			// stream pass --messaging-socket-path explicitly (or --replay-user-messages).
			let effectiveReplayUserMessages = !!options.replayUserMessages;
			if (feature("UDS_INBOX")) {
				if (
					!effectiveReplayUserMessages &&
					outputFormat === "stream-json"
				) {
					effectiveReplayUserMessages = !!(
						options as { messagingSocketPath?: string }
					).messagingSocketPath;
				}
			}

			if (getIsNonInteractiveSession()) {
				// Apply full merged settings env now (including project-scoped
				// .claude/settings.json PATH/GIT_DIR/GIT_WORK_TREE) so gitExe() and
				// the git spawn below see it. Trust is implicit in -p mode; the
				// docstring at managedEnv.ts:96-97 says this applies "potentially
				// dangerous environment variables such as LD_PRELOAD, PATH" from all
				// sources. The later call in the isNonInteractiveSession block below
				// is idempotent (Object.assign, configureGlobalAgents ejects prior
				// interceptor) and picks up any plugin-contributed env after plugin
				// init. Project settings are already loaded here:
				// applySafeConfigEnvironmentVariables in init() called
				// getSettings_DEPRECATED at managedEnv.ts:86 which merges all enabled
				// sources including projectSettings/localSettings.
				applyConfigEnvironmentVariables();

				// Spawn git status/log/branch now so the subprocess execution overlaps
				// with the getCommands await below and startDeferredPrefetches. After
				// setup() so cwd is final (setup.ts:254 may process.chdir(worktreePath)
				// for --worktree) and after the applyConfigEnvironmentVariables above
				// so PATH/GIT_DIR/GIT_WORK_TREE from all sources (trusted + project)
				// are applied. getSystemContext is memoized; the
				// prefetchSystemContextIfSafe call in startDeferredPrefetches becomes
				// a cache hit. The microtask from await getIsGit() drains at the
				// getCommands Promise.all await below. Trust is implicit in -p mode
				// (same gate as prefetchSystemContextIfSafe).
				void getSystemContext();
				// Kick getUserContext now too — its first await (fs.readFile in
				// getMemoryFiles) yields naturally, so the CLAUDE.md directory walk
				// runs during the ~280ms overlap window before the context
				// Promise.all join in print.ts. The void getUserContext() in
				// startDeferredPrefetches becomes a memoize cache-hit.
				void getUserContext();
				// Kick ensureModelStringsInitialized now — for Bedrock this triggers
				// a 100-200ms profile fetch that was awaited serially at
				// print.ts:739. updateBedrockModelStrings is sequential()-wrapped so
				// the await joins the in-flight fetch. Non-Bedrock is a sync
				// early-return (zero-cost).
				void ensureModelStringsInitialized();
			}

			// Apply --name: cache-only so no orphan file is created before the
			// session ID is finalized by --continue/--resume. materializeSessionFile
			// persists it on the first user message; REPL's useTerminalTitle reads it
			// via getCurrentSessionTitle.
			const sessionNameArg = options.name?.trim();
			if (sessionNameArg) {
				cacheSessionTitle(sessionNameArg);
			}

			// Ant model aliases (capybara-fast etc.) resolve via the
			// tengu_ant_model_override GrowthBook flag. _CACHED_MAY_BE_STALE reads
			// disk synchronously; disk is populated by a fire-and-forget write. On a
			// cold cache, parseUserSpecifiedModel returns the unresolved alias, the
			// API 404s, and -p exits before the async write lands — crashloop on
			// fresh pods. Awaiting init here populates the in-memory payload map that
			// _CACHED_MAY_BE_STALE now checks first. Gated so the warm path stays
			// non-blocking:
			//  - explicit model via --model or ANTHROPIC_MODEL (both feed alias resolution)
			//  - no env override (which short-circuits _CACHED_MAY_BE_STALE before disk)
			//  - flag absent from disk (== null also catches pre-#22279 poisoned null)
			const explicitModel = options.model || process.env.ANTHROPIC_MODEL;
			if (
				process.env.USER_TYPE === "ant" &&
				explicitModel &&
				explicitModel !== "default" &&
				!hasGrowthBookEnvOverride("tengu_ant_model_override") &&
				getGlobalConfig().cachedGrowthBookFeatures?.[
					"tengu_ant_model_override"
				] == null
			) {
				await initializeGrowthBook();
			}

			// Special case the default model with the null keyword
			// NOTE: Model resolution happens after setup() to ensure trust is established before AWS auth
			const userSpecifiedModel =
				options.model === "default"
					? getDefaultMainLoopModel()
					: options.model;
			const userSpecifiedFallbackModel =
				fallbackModel === "default"
					? getDefaultMainLoopModel()
					: fallbackModel;

			// Reuse preSetupCwd unless setup() chdir'd (worktreeEnabled). Saves a
			// getCwd() syscall in the common path.
			const currentCwd = worktreeEnabled ? getCwd() : preSetupCwd;
			logForDebugging("[STARTUP] Loading commands and agents...");
			const commandsStart = Date.now();
			// Join the promises kicked before setup() (or start fresh if
			// worktreeEnabled gated the early kick). Both memoized by cwd.
			const [commands, agentDefinitionsResult] = await Promise.all([
				commandsPromise ?? getCommands(currentCwd),
				agentDefsPromise ??
					getAgentDefinitionsWithOverrides(currentCwd),
			]);
			logForDebugging(
				`[STARTUP] Commands and agents loaded in ${Date.now() - commandsStart}ms`,
			);
			profileCheckpoint("action_commands_loaded");

			// Parse CLI agents if provided via --agents flag
			let cliAgents: typeof agentDefinitionsResult.activeAgents = [];
			if (agentsJson) {
				try {
					const parsedAgents = safeParseJSON(agentsJson);
					if (parsedAgents) {
						cliAgents = parseAgentsFromJson(
							parsedAgents,
							"flagSettings",
						);
					}
				} catch (error) {
					logError(error);
				}
			}

			// Merge CLI agents with existing ones
			const allAgents = [
				...agentDefinitionsResult.allAgents,
				...cliAgents,
			];
			const agentDefinitions = {
				...agentDefinitionsResult,
				allAgents,
				activeAgents: getActiveAgentsFromList(allAgents),
			};

			// Look up main thread agent from CLI flag or settings
			const agentSetting = agentCli ?? getInitialSettings().agent;
			let mainThreadAgentDefinition:
				| (typeof agentDefinitions.activeAgents)[number]
				| undefined;
			if (agentSetting) {
				mainThreadAgentDefinition = agentDefinitions.activeAgents.find(
					(agent) => agent.agentType === agentSetting,
				);
				if (!mainThreadAgentDefinition) {
					logForDebugging(
						`Warning: agent "${agentSetting}" not found. ` +
							`Available agents: ${agentDefinitions.activeAgents.map((a) => a.agentType).join(", ")}. ` +
							`Using default behavior.`,
					);
				}
			}

			// Store the main thread agent type in bootstrap state so hooks can access it
			setMainThreadAgentType(mainThreadAgentDefinition?.agentType);

			// Log agent flag usage — only log agent name for built-in agents to avoid leaking custom agent names
			if (mainThreadAgentDefinition) {
				logEvent("tengu_agent_flag", {
					agentType: isBuiltInAgent(mainThreadAgentDefinition)
						? (mainThreadAgentDefinition.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
						: ("custom" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS),
					...(agentCli && {
						source: "cli" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
					}),
				});
			}

			// Persist agent setting to session transcript for resume view display and restoration
			if (mainThreadAgentDefinition?.agentType) {
				saveAgentSetting(mainThreadAgentDefinition.agentType);
			}

			// Apply the agent's system prompt for non-interactive sessions
			// (interactive mode uses buildEffectiveSystemPrompt instead)
			if (
				isNonInteractiveSession &&
				mainThreadAgentDefinition &&
				!systemPrompt &&
				!isBuiltInAgent(mainThreadAgentDefinition)
			) {
				const agentSystemPrompt =
					mainThreadAgentDefinition.getSystemPrompt();
				if (agentSystemPrompt) {
					systemPrompt = agentSystemPrompt;
				}
			}

			// initialPrompt goes first so its slash command (if any) is processed;
			// user-provided text becomes trailing context.
			// Only concatenate when inputPrompt is a string. When it's an
			// AsyncIterable (SDK stream-json mode), template interpolation would
			// call .toString() producing "[object Object]". The AsyncIterable case
			// is handled in print.ts via structuredIO.prependUserMessage().
			if (mainThreadAgentDefinition?.initialPrompt) {
				if (typeof inputPrompt === "string") {
					inputPrompt = inputPrompt
						? `${mainThreadAgentDefinition.initialPrompt}\n\n${inputPrompt}`
						: mainThreadAgentDefinition.initialPrompt;
				} else if (!inputPrompt) {
					inputPrompt = mainThreadAgentDefinition.initialPrompt;
				}
			}

			// Compute effective model early so hooks can run in parallel with MCP
			// If user didn't specify a model but agent has one, use the agent's model
			let effectiveModel = userSpecifiedModel;
			if (
				!effectiveModel &&
				mainThreadAgentDefinition?.model &&
				mainThreadAgentDefinition.model !== "inherit"
			) {
				effectiveModel = parseUserSpecifiedModel(
					mainThreadAgentDefinition.model,
				);
			}

			setMainLoopModelOverride(effectiveModel);

			// Compute resolved model for hooks (use user-specified model at launch)
			setInitialMainLoopModel(getUserSpecifiedModelSetting() || null);
			const initialMainLoopModel = getInitialMainLoopModel();
			const resolvedInitialModel = parseUserSpecifiedModel(
				initialMainLoopModel ?? getDefaultMainLoopModel(),
			);

			let advisorModel: string | undefined;
			if (isAdvisorEnabled()) {
				const advisorOption = canUserConfigureAdvisor()
					? (options as { advisor?: string }).advisor
					: undefined;
				if (advisorOption) {
					logForDebugging(`[AdvisorTool] --advisor ${advisorOption}`);
					if (!modelSupportsAdvisor(resolvedInitialModel)) {
						process.stderr.write(
							chalk.red(
								`Error: The model "${resolvedInitialModel}" does not support the advisor tool.\n`,
							),
						);
						process.exit(1);
					}
					const normalizedAdvisorModel = normalizeModelStringForAPI(
						parseUserSpecifiedModel(advisorOption),
					);
					if (!isValidAdvisorModel(normalizedAdvisorModel)) {
						process.stderr.write(
							chalk.red(
								`Error: The model "${advisorOption}" cannot be used as an advisor.\n`,
							),
						);
						process.exit(1);
					}
				}
				advisorModel = canUserConfigureAdvisor()
					? (advisorOption ?? getInitialAdvisorSetting())
					: advisorOption;
				if (advisorModel) {
					logForDebugging(
						`[AdvisorTool] Advisor model: ${advisorModel}`,
					);
				}
			}

			// For tmux teammates with --agent-type, append the custom agent's prompt
			if (
				isAgentSwarmsEnabled() &&
				storedTeammateOpts?.agentId &&
				storedTeammateOpts?.agentName &&
				storedTeammateOpts?.teamName &&
				storedTeammateOpts?.agentType
			) {
				// Look up the custom agent definition
				const customAgent = agentDefinitions.activeAgents.find(
					(a) => a.agentType === storedTeammateOpts.agentType,
				);
				if (customAgent) {
					// Get the prompt - need to handle both built-in and custom agents
					let customPrompt: string | undefined;
					if (customAgent.source === "built-in") {
						// Built-in agents have getSystemPrompt that takes toolUseContext
						// We can't access full toolUseContext here, so skip for now
						logForDebugging(
							`[teammate] Built-in agent ${storedTeammateOpts.agentType} - skipping custom prompt (not supported)`,
						);
					} else {
						// Custom agents have getSystemPrompt that takes no args
						customPrompt = customAgent.getSystemPrompt();
					}

					// Log agent memory loaded event for tmux teammates
					if (customAgent.memory) {
						logEvent("tengu_agent_memory_loaded", {
							...(process.env.USER_TYPE === "ant" && {
								agent_type:
									customAgent.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
							}),
							scope: customAgent.memory as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
							source: "teammate" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
						});
					}

					if (customPrompt) {
						const customInstructions = `\n# Custom Agent Instructions\n${customPrompt}`;
						appendSystemPrompt = appendSystemPrompt
							? `${appendSystemPrompt}\n\n${customInstructions}`
							: customInstructions;
					}
				} else {
					logForDebugging(
						`[teammate] Custom agent ${storedTeammateOpts.agentType} not found in available agents`,
					);
				}
			}

			maybeActivateBrief(options);
			// defaultView: 'chat' is a persisted opt-in — check entitlement and set
			// userMsgOptIn so the tool + prompt section activate. Interactive-only:
			// defaultView is a display preference; SDK sessions have no display, and
			// the assistant installer writes defaultView:'chat' to settings.local.json
			// which would otherwise leak into --print sessions in the same directory.
			// Runs right after maybeActivateBrief() so all startup opt-in paths fire
			// BEFORE any isBriefEnabled() read below (proactive prompt's
			// briefVisibility). A persisted 'chat' after a GB kill-switch falls
			// through (entitlement fails).
			if (
				(feature("KAIROS") || feature("KAIROS_BRIEF")) &&
				!getIsNonInteractiveSession() &&
				!getUserMsgOptIn() &&
				getInitialSettings().defaultView === "chat"
			) {
				/* eslint-disable @typescript-eslint/no-require-imports */
				const { isBriefEntitled } =
					require("../../../../src/tools/BriefTool/BriefTool.js") as typeof import("../../../../src/tools/BriefTool/BriefTool.js");
				/* eslint-enable @typescript-eslint/no-require-imports */
				if (isBriefEntitled()) {
					setUserMsgOptIn(true);
				}
			}
			// Coordinator mode has its own system prompt and filters out Sleep, so
			// the generic proactive prompt would tell it to call a tool it can't
			// access and conflict with delegation instructions.
			if (
				(feature("PROACTIVE") || feature("KAIROS")) &&
				((options as { proactive?: boolean }).proactive ||
					isEnvTruthy(process.env.CLAUDE_CODE_PROACTIVE)) &&
				!coordinatorModeModule?.isCoordinatorMode()
			) {
				/* eslint-disable @typescript-eslint/no-require-imports */
				const briefVisibility =
					feature("KAIROS") || feature("KAIROS_BRIEF")
						? (
								require("../../../../src/tools/BriefTool/BriefTool.js") as typeof import("../../../../src/tools/BriefTool/BriefTool.js")
							).isBriefEnabled()
							? "Call SendUserMessage at checkpoints to mark where things stand."
							: "The user will see any text you output."
						: "The user will see any text you output.";
				/* eslint-enable @typescript-eslint/no-require-imports */
				const proactivePrompt = `\n# Proactive Mode\n\nYou are in proactive mode. Take initiative — explore, act, and make progress without waiting for instructions.\n\nStart by briefly greeting the user.\n\nYou will receive periodic <tick> prompts. These are check-ins. Do whatever seems most useful, or call Sleep if there's nothing to do. ${briefVisibility}`;
				appendSystemPrompt = appendSystemPrompt
					? `${appendSystemPrompt}\n\n${proactivePrompt}`
					: proactivePrompt;
			}

			if (feature("KAIROS") && kairosEnabled && assistantModule) {
				const assistantAddendum =
					assistantModule.getAssistantSystemPromptAddendum();
				appendSystemPrompt = appendSystemPrompt
					? `${appendSystemPrompt}\n\n${assistantAddendum}`
					: assistantAddendum;
			}

			// Ink root is only needed for interactive sessions — patchConsole in the
			// Ink constructor would swallow console output in headless mode.
			let root!: Root;
			let getFpsMetrics!: () => FpsMetrics | undefined;
			let stats!: StatsStore;

			// Show setup screens after commands are loaded
			if (!isNonInteractiveSession) {
				const ctx = getRenderContext(false);
				getFpsMetrics = ctx.getFpsMetrics;
				stats = ctx.stats;
				// Install asciicast recorder before Ink mounts (ant-only, opt-in via CLAUDE_CODE_TERMINAL_RECORDING=1)
				if (process.env.USER_TYPE === "ant") {
					installAsciicastRecorder();
				}

				const { createRoot } = await import('@anthropic/ink')
				root = await createRoot(ctx.renderOptions)

				// Log startup time now, before any blocking dialog renders. Logging
				// from REPL's first render (the old location) included however long
				// the user sat on trust/OAuth/onboarding/resume-picker — p99 was ~70s
				// dominated by dialog-wait time, not code-path startup.
				logEvent("tengu_timer", {
					event: "startup" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
					durationMs: Math.round(process.uptime() * 1000),
				});

				logForDebugging("[STARTUP] Running showSetupScreens()...");
				const setupScreensStart = Date.now();
				const onboardingShown = await showSetupScreens(
					root,
					permissionMode,
					allowDangerouslySkipPermissions,
					commands,
					enableClaudeInChrome,
					devChannels,
				);
				logForDebugging(
					`[STARTUP] showSetupScreens() completed in ${Date.now() - setupScreensStart}ms`,
				);

				// Now that trust is established and GrowthBook has auth headers,
				// resolve the --remote-control / --rc entitlement gate.
				if (
					feature("BRIDGE_MODE") &&
					remoteControlOption !== undefined
				) {
					const { getBridgeDisabledReason } =
						await import("../../../../src/bridge/bridgeEnabled.js");
					const disabledReason = await getBridgeDisabledReason();
					remoteControl = disabledReason === null;
					if (disabledReason) {
						process.stderr.write(
							chalk.yellow(
								`${disabledReason}\n--rc flag ignored.\n`,
							),
						);
					}
				}

				// Check for pending agent memory snapshot updates (only for --agent mode, ant-only)
				if (
					feature("AGENT_MEMORY_SNAPSHOT") &&
					mainThreadAgentDefinition &&
					isCustomAgent(mainThreadAgentDefinition) &&
					mainThreadAgentDefinition.memory &&
					mainThreadAgentDefinition.pendingSnapshotUpdate
				) {
					const agentDef = mainThreadAgentDefinition;
					const choice = await launchSnapshotUpdateDialog(root, {
						agentType: agentDef.agentType,
						scope: agentDef.memory!,
						snapshotTimestamp:
							agentDef.pendingSnapshotUpdate!.snapshotTimestamp,
					});
					if (choice === "merge") {
						const { buildMergePrompt } =
							await import("../../../../src/components/agents/SnapshotUpdateDialog.js");
						const mergePrompt = buildMergePrompt(
							agentDef.agentType,
							agentDef.memory!,
						);
						inputPrompt = inputPrompt
							? `${mergePrompt}\n\n${inputPrompt}`
							: mergePrompt;
					}
					agentDef.pendingSnapshotUpdate = undefined;
				}

				// Skip executing /login if we just completed onboarding for it
				if (
					onboardingShown &&
					prompt?.trim().toLowerCase() === "/login"
				) {
					prompt = "";
				}

				if (onboardingShown) {
					// Refresh auth-dependent services now that the user has logged in during onboarding.
					// Keep in sync with the post-login logic in src/commands/login.tsx
					void refreshRemoteManagedSettings();
					void refreshPolicyLimits();
					// Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
					resetUserCache();
					// Refresh GrowthBook after login to get updated feature flags (e.g., for claude.ai MCPs)
					refreshGrowthBookAfterAuthChange();
					// Clear any stale trusted device token then enroll for Remote Control.
					// Both self-gate on tengu_sessions_elevated_auth_enforcement internally
					// — enrollTrustedDevice() via checkGate_CACHED_OR_BLOCKING (awaits
					// the GrowthBook reinit above), clearTrustedDeviceToken() via the
					// sync cached check (acceptable since clear is idempotent).
					void import("../../../../src/bridge/trustedDevice.js").then((m) => {
						m.clearTrustedDeviceToken();
						return m.enrollTrustedDevice();
					});
				}

				// Validate that the active token's org matches forceLoginOrgUUID (if set
				// in managed settings). Runs after onboarding so managed settings and
				// login state are fully loaded.
				const orgValidation = await validateForceLoginOrg();
				if (!orgValidation.valid) {
					await exitWithError(root, orgValidation.message);
				}
			}

			// If gracefulShutdown was initiated (e.g., user rejected trust dialog),
			// process.exitCode will be set. Skip all subsequent operations that could
			// trigger code execution before the process exits (e.g. we don't want apiKeyHelper
			// to run if trust was not established).
			if (process.exitCode !== undefined) {
				logForDebugging(
					"Graceful shutdown initiated, skipping further initialization",
				);
				return;
			}

			// Initialize LSP manager AFTER trust is established (or in non-interactive mode
			// where trust is implicit). This prevents plugin LSP servers from executing
			// code in untrusted directories before user consent.
			// Must be after inline plugins are set (if any) so --plugin-dir LSP servers are included.
			initializeLspServerManager();

			// Show settings validation errors after trust is established
			// MCP config errors don't block settings from loading, so exclude them
			if (!isNonInteractiveSession) {
				const { errors } = getSettingsWithErrors();
				const nonMcpErrors = errors.filter((e) => !e.mcpErrorMetadata);
				if (nonMcpErrors.length > 0) {
					await launchInvalidSettingsDialog(root, {
						settingsErrors: nonMcpErrors,
						onExit: () => gracefulShutdownSync(1),
					});
				}
			}

			// Check quota status, fast mode, passes eligibility, and bootstrap data
			// after trust is established. These make API calls which could trigger
			// apiKeyHelper execution.
			// --bare / SIMPLE: skip — these are cache-warms for the REPL's
			// first-turn responsiveness (quota, passes, fastMode, bootstrap data). Fast
			// mode doesn't apply to the Agent SDK anyway (see getFastModeUnavailableReason).
			const bgRefreshThrottleMs = getFeatureValue_CACHED_MAY_BE_STALE(
				"tengu_cicada_nap_ms",
				0,
			);
			const lastPrefetched = getGlobalConfig().startupPrefetchedAt ?? 0;
			const skipStartupPrefetches =
				isBareMode() ||
				(bgRefreshThrottleMs > 0 &&
					Date.now() - lastPrefetched < bgRefreshThrottleMs);

			if (!skipStartupPrefetches) {
				const lastPrefetchedInfo =
					lastPrefetched > 0
						? ` last ran ${Math.round((Date.now() - lastPrefetched) / 1000)}s ago`
						: "";
				logForDebugging(
					`Starting background startup prefetches${lastPrefetchedInfo}`,
				);

				checkQuotaStatus().catch((error) => logError(error));

				// Fetch bootstrap data from the server and update all cache values.
				void fetchBootstrapData();

				// TODO: Consolidate other prefetches into a single bootstrap request.
				void prefetchPassesEligibility();
				if (
					!getFeatureValue_CACHED_MAY_BE_STALE(
						"tengu_miraculo_the_bard",
						false,
					)
				) {
					void prefetchFastModeStatus();
				} else {
					// Kill switch skips the network call, not org-policy enforcement.
					// Resolve from cache so orgStatus doesn't stay 'pending' (which
					// getFastModeUnavailableReason treats as permissive).
					resolveFastModeStatusFromCache();
				}
				if (bgRefreshThrottleMs > 0) {
					saveGlobalConfig((current) => ({
						...current,
						startupPrefetchedAt: Date.now(),
					}));
				}
			} else {
				logForDebugging(
					`Skipping startup prefetches, last ran ${Math.round((Date.now() - lastPrefetched) / 1000)}s ago`,
				);
				// Resolve fast mode org status from cache (no network)
				resolveFastModeStatusFromCache();
			}

			if (!isNonInteractiveSession) {
				void refreshExampleCommands(); // Pre-fetch example commands (runs git log, no API call)
			}

			// Resolve MCP configs (started early, overlaps with setup/trust dialog work)
			const { servers: existingMcpConfigs } = await mcpConfigPromise;
			logForDebugging(
				`[STARTUP] MCP configs resolved in ${mcpConfigResolvedMs}ms (awaited at +${Date.now() - mcpConfigStart}ms)`,
			);
			// CLI flag (--mcp-config) should override file-based configs, matching settings precedence
			const allMcpConfigs = {
				...existingMcpConfigs,
				...dynamicMcpConfig,
			};

			// Separate SDK configs from regular MCP configs
			const sdkMcpConfigs: Record<string, McpSdkServerConfig> = {};
			const regularMcpConfigs: Record<string, ScopedMcpServerConfig> = {};

			for (const [name, config] of Object.entries(allMcpConfigs)) {
				const typedConfig = config as
					| ScopedMcpServerConfig
					| McpSdkServerConfig;
				if (typedConfig.type === "sdk") {
					sdkMcpConfigs[name] = typedConfig as McpSdkServerConfig;
				} else {
					regularMcpConfigs[name] =
						typedConfig as ScopedMcpServerConfig;
				}
			}

			profileCheckpoint("action_mcp_configs_loaded");

			// Prefetch MCP resources after trust dialog (this is where execution happens).
			// Interactive mode only: print mode defers connects until headlessStore exists
			// and pushes per-server (below), so ToolSearch's pending-client handling works
			// and one slow server doesn't block the batch.
			const localMcpPromise = isNonInteractiveSession
				? Promise.resolve({ clients: [], tools: [], commands: [] })
				: prefetchAllMcpResources(regularMcpConfigs);
			const claudeaiMcpPromise = isNonInteractiveSession
				? Promise.resolve({ clients: [], tools: [], commands: [] })
				: claudeaiConfigPromise.then((configs) =>
						Object.keys(configs).length > 0
							? prefetchAllMcpResources(configs)
							: { clients: [], tools: [], commands: [] },
					);
			// Merge with dedup by name: each prefetchAllMcpResources call independently
			// adds helper tools (ListMcpResourcesTool, ReadMcpResourceTool) via
			// local dedup flags, so merging two calls can yield duplicates. print.ts
			// already uniqBy's the final tool pool, but dedup here keeps appState clean.
			const mcpPromise = Promise.all([
				localMcpPromise,
				claudeaiMcpPromise,
			]).then(([local, claudeai]) => ({
				clients: [...local.clients, ...claudeai.clients],
				tools: uniqBy([...local.tools, ...claudeai.tools], "name"),
				commands: uniqBy(
					[...local.commands, ...claudeai.commands],
					"name",
				),
			}));

			// Start hooks early so they run in parallel with MCP connections.
			// Skip for initOnly/init/maintenance (handled separately), non-interactive
			// (handled via setupTrigger), and resume/continue (conversationRecovery.ts
			// fires 'resume' instead — without this guard, hooks fire TWICE on /resume
			// and the second systemMessage clobbers the first. gh-30825)
			const hooksPromise =
				initOnly ||
				init ||
				maintenance ||
				isNonInteractiveSession ||
				options.continue ||
				options.resume
					? null
					: processSessionStartHooks("startup", {
							agentType: mainThreadAgentDefinition?.agentType,
							model: resolvedInitialModel,
						});

			// MCP never blocks REPL render OR turn 1 TTFT. useManageMCPConnections
			// populates appState.mcp async as servers connect (connectToServer is
			// memoized — the prefetch calls above and the hook converge on the same
			// connections). getToolUseContext reads store.getState() fresh via
			// computeTools(), so turn 1 sees whatever's connected by query time.
			// Slow servers populate for turn 2+. Matches interactive-no-prompt
			// behavior. Print mode: per-server push into headlessStore (below).
			const hookMessages: Awaited<NonNullable<typeof hooksPromise>> = [];
			// Suppress transient unhandledRejection — the prefetch warms the
			// memoized connectToServer cache but nobody awaits it in interactive.
			mcpPromise.catch(() => {});

			const mcpClients: Awaited<typeof mcpPromise>["clients"] = [];
			const mcpTools: Awaited<typeof mcpPromise>["tools"] = [];
			const mcpCommands: Awaited<typeof mcpPromise>["commands"] = [];

			let thinkingEnabled = shouldEnableThinkingByDefault();
			let thinkingConfig: ThinkingConfig =
				thinkingEnabled !== false
					? { type: "adaptive" }
					: { type: "disabled" };

			if (
				options.thinking === "adaptive" ||
				options.thinking === "enabled"
			) {
				thinkingEnabled = true;
				thinkingConfig = { type: "adaptive" };
			} else if (options.thinking === "disabled") {
				thinkingEnabled = false;
				thinkingConfig = { type: "disabled" };
			} else {
				const maxThinkingTokens = process.env.MAX_THINKING_TOKENS
					? parseInt(process.env.MAX_THINKING_TOKENS, 10)
					: options.maxThinkingTokens;
				if (maxThinkingTokens !== undefined) {
					if (maxThinkingTokens > 0) {
						thinkingEnabled = true;
						thinkingConfig = {
							type: "enabled",
							budgetTokens: maxThinkingTokens,
						};
					} else if (maxThinkingTokens === 0) {
						thinkingEnabled = false;
						thinkingConfig = { type: "disabled" };
					}
				}
			}

			logForDiagnosticsNoPII("info", "started", {
				version: MACRO.VERSION,
				is_native_binary: isInBundledMode(),
			});

			registerCleanup(async () => {
				logForDiagnosticsNoPII("info", "exited");
			});

			void logTenguInit({
				hasInitialPrompt: Boolean(prompt),
				hasStdin: Boolean(inputPrompt),
				verbose,
				debug,
				debugToStderr,
				print: print ?? false,
				outputFormat: outputFormat ?? "text",
				inputFormat: inputFormat ?? "text",
				numAllowedTools: allowedTools.length,
				numDisallowedTools: disallowedTools.length,
				mcpClientCount: Object.keys(allMcpConfigs).length,
				worktreeEnabled,
				skipWebFetchPreflight:
					getInitialSettings().skipWebFetchPreflight,
				githubActionInputs: process.env.GITHUB_ACTION_INPUTS,
				dangerouslySkipPermissionsPassed:
					dangerouslySkipPermissions ?? false,
				permissionMode,
				modeIsBypass: permissionMode === "bypassPermissions",
				allowDangerouslySkipPermissionsPassed:
					allowDangerouslySkipPermissions,
				systemPromptFlag: systemPrompt
					? options.systemPromptFile
						? "file"
						: "flag"
					: undefined,
				appendSystemPromptFlag: appendSystemPrompt
					? options.appendSystemPromptFile
						? "file"
						: "flag"
					: undefined,
				thinkingConfig,
				assistantActivationPath:
					feature("KAIROS") && kairosEnabled
						? assistantModule?.getAssistantActivationPath()
						: undefined,
			});

			// Log context metrics once at initialization
			void logContextMetrics(regularMcpConfigs, toolPermissionContext);

			void logPermissionContextForAnts(null, "initialization");

			logManagedSettings();

			// Register PID file for concurrent-session detection (~/.claude/sessions/)
			// and fire multi-clauding telemetry. Lives here (not init.ts) so only the
			// REPL path registers — not subcommands like `claude doctor`. Chained:
			// count must run after register's write completes or it misses our own file.
			void registerSession().then((registered) => {
				if (!registered) return;
				if (sessionNameArg) {
					void updateSessionName(sessionNameArg);
				}
				void countConcurrentSessions().then((count) => {
					if (count >= 2) {
						logEvent("tengu_concurrent_sessions", {
							num_sessions: count,
						});
					}
				});
			});

			// Initialize versioned plugins system (triggers V1→V2 migration if
			// needed). Then run orphan GC, THEN warm the Grep/Glob exclusion cache.
			// Sequencing matters: the warmup scans disk for .orphaned_at markers,
			// so it must see the GC's Pass 1 (remove markers from reinstalled
			// versions) and Pass 2 (stamp unmarked orphans) already applied. The
			// warm also lands before autoupdate (fires on first submit in REPL)
			// can orphan this session's active version underneath us.
			// --bare / SIMPLE: skip plugin version sync + orphan cleanup. These
			// are install/upgrade bookkeeping that scripted calls don't need —
			// the next interactive session will reconcile. The await here was
			// blocking -p on a marketplace round-trip.
			if (isBareMode()) {
				// skip — no-op
			} else if (isNonInteractiveSession) {
				// In headless mode, await to ensure plugin sync completes before CLI exits
				await initializeVersionedPlugins();
				profileCheckpoint("action_after_plugins_init");
				void cleanupOrphanedPluginVersionsInBackground().then(() =>
					getGlobExclusionsForPluginCache(),
				);
			} else {
				// In interactive mode, fire-and-forget — this is purely bookkeeping
				// that doesn't affect runtime behavior of the current session
				void initializeVersionedPlugins().then(async () => {
					profileCheckpoint("action_after_plugins_init");
					await cleanupOrphanedPluginVersionsInBackground();
					void getGlobExclusionsForPluginCache();
				});
			}

			const setupTrigger =
				initOnly || init ? "init" : maintenance ? "maintenance" : null;
			if (initOnly) {
				applyConfigEnvironmentVariables();
				await processSetupHooks("init", { forceSyncExecution: true });
				await processSessionStartHooks("startup", {
					forceSyncExecution: true,
				});
				gracefulShutdownSync(0);
				return;
			}

			// --print mode
			if (isNonInteractiveSession) {
				if (outputFormat === "stream-json" || outputFormat === "json") {
					setHasFormattedOutput(true);
				}

				// Apply full environment variables in print mode since trust dialog is bypassed
				// This includes potentially dangerous environment variables from untrusted sources
				// but print mode is considered trusted (as documented in help text)
				applyConfigEnvironmentVariables();

				// Initialize telemetry after env vars are applied so OTEL endpoint env vars and
				// otelHeadersHelper (which requires trust to execute) are available.
				initializeTelemetryAfterTrust();

				// Kick SessionStart hooks now so the subprocess spawn overlaps with
				// MCP connect + plugin init + print.ts import below. loadInitialMessages
				// joins this at print.ts:4397. Guarded same as loadInitialMessages —
				// continue/resume/teleport paths don't fire startup hooks (or fire them
				// conditionally inside the resume branch, where this promise is
				// undefined and the ?? fallback runs). Also skip when setupTrigger is
				// set — those paths run setup hooks first (print.ts:544), and session
				// start hooks must wait until setup completes.
				const sessionStartHooksPromise =
					options.continue ||
					options.resume ||
					teleport ||
					setupTrigger
						? undefined
						: processSessionStartHooks("startup");
				// Suppress transient unhandledRejection if this rejects before
				// loadInitialMessages awaits it. Downstream await still observes the
				// rejection — this just prevents the spurious global handler fire.
				sessionStartHooksPromise?.catch(() => {});

				profileCheckpoint("before_validateForceLoginOrg");
				// Validate org restriction for non-interactive sessions
				const orgValidation = await validateForceLoginOrg();
				if (!orgValidation.valid) {
					process.stderr.write(orgValidation.message + "\n");
					process.exit(1);
				}

				// Headless mode supports all prompt commands and some local commands
				// If disableSlashCommands is true, return empty array
				const headlessHost = createHeadlessHost(({ runtimeGraph }) => ({
					runtimeGraph,
					createSession: params => {
						syncRuntimeHandlesFromHeadlessParams(runtimeGraph.handles, params.store);
						return createHeadlessSession(params);
					},
				}), runtimeHandles);
				const headlessSession = headlessHost.createSession({
					commands,
					disableSlashCommands,
					store: {
						mcpClients,
						mcpCommands,
						mcpTools,
						toolPermissionContext,
						effort: options.effort,
						effectiveModel: effectiveModel ?? null,
						...(isAdvisorEnabled() && advisorModel
							? { advisorModel }
							: {}),
						kairosEnabled,
					},
					tools,
					sdkMcpConfigs,
					agents: agentDefinitions.activeAgents,
					options: {
						continue: options.continue,
						resume: options.resume,
						verbose: verbose,
						outputFormat: outputFormat,
						jsonSchema,
						permissionPromptToolName: options.permissionPromptTool,
						allowedTools,
						thinkingConfig,
						maxTurns: options.maxTurns,
						maxBudgetUsd: options.maxBudgetUsd,
						taskBudget: options.taskBudget
							? { total: options.taskBudget }
							: undefined,
						systemPrompt,
						appendSystemPrompt,
						userSpecifiedModel: effectiveModel,
						fallbackModel: userSpecifiedFallbackModel,
						teleport,
						sdkUrl,
						replayUserMessages: effectiveReplayUserMessages,
						includePartialMessages: effectiveIncludePartialMessages,
						forkSession: options.forkSession || false,
						resumeSessionAt: options.resumeSessionAt || undefined,
						rewindFiles: options.rewindFiles,
						enableAuthStatus: options.enableAuthStatus,
						agent: agentCli,
						workload: options.workload,
						setupTrigger: setupTrigger ?? undefined,
						sessionStartHooksPromise,
					},
				});
				const { store: headlessStore } = headlessSession;

				// Check if bypassPermissions should be disabled based on Statsig gate
				// This runs in parallel to the code below, to avoid blocking the main loop.
				if (
					toolPermissionContext.mode === "bypassPermissions" ||
					allowDangerouslySkipPermissions
				) {
					void checkAndDisableBypassPermissions(
						toolPermissionContext,
					);
				}

				// Async check of auto mode gate — corrects state and disables auto if needed.
				// Gated on TRANSCRIPT_CLASSIFIER (not USER_TYPE) so GrowthBook kill switch runs for external builds too.
				if (feature("TRANSCRIPT_CLASSIFIER")) {
					void verifyAutoModeGateAccess(
						toolPermissionContext,
						headlessStore.getState().fastMode,
					).then(({ updateContext }) => {
						headlessStore.setState((prev) => {
							const nextCtx = updateContext(
								prev.toolPermissionContext,
							);
							if (nextCtx === prev.toolPermissionContext)
								return prev;
							return { ...prev, toolPermissionContext: nextCtx };
						});
					});
				}

				// Set global state for session persistence
				if (options.sessionPersistence === false) {
					setSessionPersistenceDisabled(true);
				}

				// Store SDK betas in global state for context window calculation
				// Only store allowed betas (filters by allowlist and subscriber status)
				setSdkBetas(filterAllowedSdkBetas(betas));

				// Print-mode MCP: per-server incremental push into headlessStore.
				// Mirrors useManageMCPConnections — push pending first (so ToolSearch's
				// pending-check at ToolSearchTool.ts:334 sees them), then replace with
				// connected/failed as each server settles.
				const connectMcpBatch = (
					configs: Record<string, ScopedMcpServerConfig>,
					label: string,
				): Promise<void> => {
					if (Object.keys(configs).length === 0)
						return Promise.resolve();
					headlessStore.setState((prev) => ({
						...prev,
						mcp: {
							...prev.mcp,
							clients: [
								...prev.mcp.clients,
								...Object.entries(configs).map(
									([name, config]) => ({
										name,
										type: "pending" as const,
										config,
									}),
								),
							],
						},
					}));
					return getMcpToolsCommandsAndResources(
						({ client, tools, commands }) => {
							headlessStore.setState((prev) => ({
								...prev,
								mcp: {
									...prev.mcp,
									clients: prev.mcp.clients.some(
										(c) => c.name === client.name,
									)
										? prev.mcp.clients.map((c) =>
												c.name === client.name
													? client
													: c,
											)
										: [...prev.mcp.clients, client],
									tools: uniqBy(
										[...prev.mcp.tools, ...tools],
										"name",
									),
									commands: uniqBy(
										[...prev.mcp.commands, ...commands],
										"name",
									),
								},
							}));
						},
						configs,
					).catch((err) =>
						logForDebugging(`[MCP] ${label} connect error: ${err}`),
					);
				};
				// Await all MCP configs — print mode is often single-turn, so
				// "late-connecting servers visible next turn" doesn't help. SDK init
				// message and turn-1 tool list both need configured MCP tools present.
				// Zero-server case is free via the early return in connectMcpBatch.
				// Connectors parallelize inside getMcpToolsCommandsAndResources
				// (processBatched with Promise.all). claude.ai is awaited too — its
				// fetch was kicked off early (line ~2558) so only residual time blocks
				// here. --bare skips claude.ai entirely for perf-sensitive scripts.
				profileCheckpoint("before_connectMcp");
				await connectMcpBatch(regularMcpConfigs, "regular");
				profileCheckpoint("after_connectMcp");
				// Dedup: suppress plugin MCP servers that duplicate a claude.ai
				// connector (connector wins), then connect claude.ai servers.
				// Bounded wait — #23725 made this blocking so single-turn -p sees
				// connectors, but with 40+ slow connectors tengu_startup_perf p99
				// climbed to 76s. If fetch+connect doesn't finish in time, proceed;
				// the promise keeps running and updates headlessStore in the
				// background so turn 2+ still sees connectors.
				const CLAUDE_AI_MCP_TIMEOUT_MS = 5_000;
				const claudeaiConnect = claudeaiConfigPromise.then(
					(claudeaiConfigs) => {
						if (Object.keys(claudeaiConfigs).length > 0) {
							const claudeaiSigs = new Set<string>();
							for (const config of Object.values(
								claudeaiConfigs,
							)) {
								const sig = getMcpServerSignature(config);
								if (sig) claudeaiSigs.add(sig);
							}
							const suppressed = new Set<string>();
							for (const [name, config] of Object.entries(
								regularMcpConfigs,
							)) {
								if (!name.startsWith("plugin:")) continue;
								const sig = getMcpServerSignature(config);
								if (sig && claudeaiSigs.has(sig))
									suppressed.add(name);
							}
							if (suppressed.size > 0) {
								logForDebugging(
									`[MCP] Lazy dedup: suppressing ${suppressed.size} plugin server(s) that duplicate claude.ai connectors: ${[...suppressed].join(", ")}`,
								);
								// Disconnect before filtering from state. Only connected
								// servers need cleanup — clearServerCache on a never-connected
								// server triggers a real connect just to kill it (memoize
								// cache-miss path, see useManageMCPConnections.ts:870).
								for (const c of headlessStore.getState().mcp
									.clients) {
									if (
										!suppressed.has(c.name) ||
										c.type !== "connected"
									)
										continue;
									c.client.onclose = undefined;
									void clearServerCache(
										c.name,
										c.config,
									).catch(() => {});
								}
								headlessStore.setState((prev) => {
									let {
										clients,
										tools,
										commands,
										resources,
									} = prev.mcp;
									clients = clients.filter(
										(c) => !suppressed.has(c.name),
									);
									tools = tools.filter(
										(t) =>
											!t.mcpInfo ||
											!suppressed.has(
												t.mcpInfo.serverName,
											),
									);
									for (const name of suppressed) {
										commands = excludeCommandsByServer(
											commands,
											name,
										);
										resources = excludeResourcesByServer(
											resources,
											name,
										);
									}
									return {
										...prev,
										mcp: {
											...prev.mcp,
											clients,
											tools,
											commands,
											resources,
										},
									};
								});
							}
						}
						// Suppress claude.ai connectors that duplicate an enabled
						// manual server (URL-signature match). Plugin dedup above only
						// handles `plugin:*` keys; this catches manual `.mcp.json` entries.
						// plugin:* must be excluded here — step 1 already suppressed
						// those (claude.ai wins); leaving them in suppresses the
						// connector too, and neither survives (gh-39974).
						const nonPluginConfigs = pickBy(
							regularMcpConfigs,
							(_, n) => !n.startsWith("plugin:"),
						);
						const { servers: dedupedClaudeAi } =
							dedupClaudeAiMcpServers(
								claudeaiConfigs,
								nonPluginConfigs,
							);
						return connectMcpBatch(dedupedClaudeAi, "claudeai");
					},
				);
				let claudeaiTimer: ReturnType<typeof setTimeout> | undefined;
				const claudeaiTimedOut = await Promise.race([
					claudeaiConnect.then(() => false),
					new Promise<boolean>((resolve) => {
						claudeaiTimer = setTimeout(
							(r) => r(true),
							CLAUDE_AI_MCP_TIMEOUT_MS,
							resolve,
						);
					}),
				]);
				if (claudeaiTimer) clearTimeout(claudeaiTimer);
				if (claudeaiTimedOut) {
					logForDebugging(
						`[MCP] claude.ai connectors not ready after ${CLAUDE_AI_MCP_TIMEOUT_MS}ms — proceeding; background connection continues`,
					);
				}
				profileCheckpoint("after_connectMcp_claudeai");

				// In headless mode, start deferred prefetches immediately (no user typing delay)
				// --bare / SIMPLE: startDeferredPrefetches early-returns internally.
				// backgroundHousekeeping (initExtractMemories, pruneShellSnapshots,
				// cleanupOldMessageFiles) and sdkHeapDumpMonitor are all bookkeeping
				// that scripted calls don't need — the next interactive session reconciles.
				if (!isBareMode()) {
					startDeferredPrefetches();
					void import("../../../../src/utils/backgroundHousekeeping.js").then((m) =>
						m.startBackgroundHousekeeping(),
					);
					if (process.env.USER_TYPE === "ant") {
						void import("../../../../src/utils/sdkHeapDumpMonitor.js").then((m) =>
							m.startSdkMemoryMonitor(),
						);
					}
				}

				logSessionTelemetry();
				void headlessSession.run(inputPrompt);
				return;
				}

				// Log model config at startup
				logEvent("tengu_startup_manual_model_config", {
				cli_flag:
					options.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				env_var: process.env
					.ANTHROPIC_MODEL as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				settings_file: (getInitialSettings() || {})
					.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				subscriptionType:
					getSubscriptionType() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				agent: agentSetting as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			});

			// Get deprecation warning for the initial model (resolvedInitialModel computed earlier for hooks parallelization)
			const deprecationWarning =
				getModelDeprecationWarning(resolvedInitialModel);

			// Build initial notification queue
			const initialNotifications: Array<{
				key: string;
				text: string;
				color?: "warning";
				priority: "high";
			}> = [];
			if (permissionModeNotification) {
				initialNotifications.push({
					key: "permission-mode-notification",
					text: permissionModeNotification,
					priority: "high",
				});
			}
			if (deprecationWarning) {
				initialNotifications.push({
					key: "model-deprecation-warning",
					text: deprecationWarning,
					color: "warning",
					priority: "high",
				});
			}
			if (overlyBroadBashPermissions.length > 0) {
				const displayList = uniq(
					overlyBroadBashPermissions.map((p) => p.ruleDisplay),
				);
				const displays = displayList.join(", ");
				const sources = uniq(
					overlyBroadBashPermissions.map((p) => p.sourceDisplay),
				).join(", ");
				const n = displayList.length;
				initialNotifications.push({
					key: "overly-broad-bash-notification",
					text: `${displays} allow ${plural(n, "rule")} from ${sources} ${plural(n, "was", "were")} ignored \u2014 not available for Ants, please use auto-mode instead`,
					color: "warning",
					priority: "high",
				});
			}

			const effectiveToolPermissionContext = {
				...toolPermissionContext,
				mode:
					isAgentSwarmsEnabled() &&
					getTeammateUtils().isPlanModeRequired()
						? ("plan" as const)
						: toolPermissionContext.mode,
			};
			// All startup opt-in paths (--tools, --brief, defaultView) have fired
			// above; initialIsBriefOnly just reads the resulting state.
			const initialIsBriefOnly =
				feature("KAIROS") || feature("KAIROS_BRIEF")
					? getUserMsgOptIn()
					: false;
			const fullRemoteControl =
				remoteControl || getRemoteControlAtStartup() || kairosEnabled;
			let ccrMirrorEnabled = false;
			if (feature("CCR_MIRROR") && !fullRemoteControl) {
				/* eslint-disable @typescript-eslint/no-require-imports */
				const { isCcrMirrorEnabled } =
					require("../../../../src/bridge/bridgeEnabled.js") as typeof import("../../../../src/bridge/bridgeEnabled.js");
				/* eslint-enable @typescript-eslint/no-require-imports */
				ccrMirrorEnabled = isCcrMirrorEnabled();
			}

				const initialSettings = getInitialSettings();
				const globalConfig = getGlobalConfig();
				const initialExpandedView = globalConfig.showSpinnerTree
					? "teammates"
					: globalConfig.showExpandedTodos
						? "tasks"
						: "none";
				const initialAttributionState = createEmptyAttributionState();
				const initialPromptSuggestionEnabled =
					shouldEnablePromptSuggestion();
				const initialEffortValue =
					parseEffortValue(options.effort) ??
					toPersistableEffort(initialSettings.effortLevel);
				const initialFastMode =
					isFastModeEnabled() &&
					getFastModeUnavailableReason() === null &&
					isFastModeSupportedByModel(resolvedInitialModel) &&
					!initialSettings.fastModePerSessionOptIn &&
					initialSettings.fastMode === true;
				const initialTeamContext = feature("KAIROS")
					? (assistantTeamContext ?? computeInitialTeamContext?.())
					: computeInitialTeamContext?.();
				const initialState: AppState = {
					settings: initialSettings,
					tasks: {},
					agentNameRegistry: new Map(),
					verbose: verbose ?? globalConfig.verbose ?? false,
					mainLoopModel: initialMainLoopModel,
					mainLoopModelForSession: null,
					isBriefOnly: initialIsBriefOnly,
					expandedView: initialExpandedView,
				showTeammateMessagePreview: isAgentSwarmsEnabled()
					? false
					: undefined,
				selectedIPAgentIndex: -1,
				coordinatorTaskIndex: -1,
				viewSelectionMode: "none",
				footerSelection: null,
				toolPermissionContext: effectiveToolPermissionContext,
				agent: mainThreadAgentDefinition?.agentType,
				agentDefinitions,
				mcp: {
					clients: [],
					tools: [],
					commands: [],
					resources: {},
					pluginReconnectKey: 0,
				},
				plugins: {
					enabled: [],
					disabled: [],
					commands: [],
					errors: [],
					installationStatus: {
						marketplaces: [],
						plugins: [],
					},
					needsRefresh: false,
				},
				statusLineText: undefined,
				kairosEnabled,
				remoteSessionUrl: undefined,
				remoteConnectionStatus: "connecting",
				remoteBackgroundTaskCount: 0,
				replBridgeEnabled: fullRemoteControl || ccrMirrorEnabled,
				replBridgeExplicit: remoteControl,
				replBridgeOutboundOnly: ccrMirrorEnabled,
				replBridgeConnected: false,
				replBridgeSessionActive: false,
				replBridgeReconnecting: false,
				replBridgeConnectUrl: undefined,
				replBridgeSessionUrl: undefined,
				replBridgeEnvironmentId: undefined,
				replBridgeSessionId: undefined,
				replBridgeError: undefined,
				replBridgeInitialName: remoteControlName,
				showRemoteCallout: false,
				notifications: {
					current: null,
					queue: initialNotifications,
				},
				elicitation: {
					queue: [],
				},
				todos: {},
				remoteAgentTaskSuggestions: [],
				fileHistory: {
					snapshots: [],
					trackedFiles: new Set(),
					snapshotSequence: 0,
				},
					attribution: initialAttributionState,
					thinkingEnabled,
					promptSuggestionEnabled:
						initialPromptSuggestionEnabled,
				sessionHooks: new Map(),
				inbox: {
					messages: [],
				},
				promptSuggestion: {
					text: null,
					promptId: null,
					shownAt: 0,
					acceptedAt: 0,
					generationRequestId: null,
				},
				speculation: IDLE_SPECULATION_STATE,
				speculationSessionTimeSavedMs: 0,
				skillImprovement: {
					suggestion: null,
				},
				workerSandboxPermissions: {
					queue: [],
					selectedIndex: 0,
				},
				pendingWorkerRequest: null,
				pendingSandboxRequest: null,
				authVersion: 0,
				initialMessage: inputPrompt
					? {
							message: createUserMessage({
								content: String(inputPrompt),
							}),
						}
					: null,
					effortValue: initialEffortValue,
					activeOverlays: new Set<string>(),
					fastMode: initialFastMode,
					...(isAdvisorEnabled() && advisorModel && { advisorModel }),
				// Compute teamContext synchronously to avoid useEffect setState during render.
				// KAIROS: assistantTeamContext takes precedence — set earlier in the
				// KAIROS block so Agent(name: "foo") can spawn in-process teammates
				// without TeamCreate. computeInitialTeamContext() is for tmux-spawned
				// teammates reading their own identity, not the assistant-mode leader.
					teamContext: initialTeamContext,
				};

				// Add CLI initial prompt to history
				if (inputPrompt) {
					addToHistory(String(inputPrompt));
			}

			const initialTools = mcpTools;

			// Increment numStartups synchronously — first-render readers like
			// shouldShowEffortCallout (via useState initializer) need the updated
			// value before setImmediate fires. Defer only telemetry.
			saveGlobalConfig((current) => ({
				...current,
				numStartups: (current.numStartups ?? 0) + 1,
			}));
			setImmediate(() => {
				void logStartupTelemetry();
				logSessionTelemetry();
			});

			// Set up per-turn session environment data uploader (ant-only build).
			// Default-enabled for all ant users when working in an Anthropic-owned
			// repo. Captures git/filesystem state (NOT transcripts) at each turn so
			// environments can be recreated at any user message index. Gating:
			//   - Build-time: this import is stubbed in external builds.
			//   - Runtime: uploader checks github.com/anthropics/* remote + gcloud auth.
			//   - Safety: CLAUDE_CODE_DISABLE_SESSION_DATA_UPLOAD=1 bypasses (tests set this).
			// Import is dynamic + async to avoid adding startup latency.
			const sessionUploaderPromise =
				process.env.USER_TYPE === "ant"
					? import("../../../../src/utils/sessionDataUploader.js")
					: null;

			// Defer session uploader resolution to the onTurnComplete callback to avoid
			// adding a new top-level await in main.tsx (performance-critical path).
			// The per-turn auth logic in sessionDataUploader.ts handles unauthenticated
			// state gracefully (re-checks each turn, so auth recovery mid-session works).
			const uploaderReady = sessionUploaderPromise
				? sessionUploaderPromise
						.then((mod) => mod.createSessionTurnUploader())
						.catch(() => null)
				: null;

			const interactiveHost = createInteractiveHost(
				({ runtimeGraph }) => ({
					runtimeGraph,
					launchRepl: (
						root: Root,
						session: InteractiveHostSession<AppState>,
						appProps: AppWrapperProps,
						replProps: Parameters<typeof launchRepl>[0]['replProps'],
					) =>
						launchRepl(
							{
								root,
								session,
								appProps,
								replProps,
								renderAndRun,
							},
						),
				}),
				runtimeHandles,
			);

			const launchInteractiveSession = (
				initialState: AppState,
				replProps: Parameters<typeof launchRepl>[0]["replProps"],
			) => {
				const session = interactiveHost.createSession({
					initialAppState: initialState,
				});
				return interactiveHost.launchRepl(
					root,
					session,
					{
						getFpsMetrics,
						stats,
						initialState,
					},
					replProps,
				);
			};

				const sessionConfig = {
				debug: debug || debugToStderr,
				commands: [...commands, ...mcpCommands],
				initialTools,
				mcpClients,
				autoConnectIdeFlag: ide,
				mainThreadAgentDefinition,
				disableSlashCommands,
				dynamicMcpConfig,
				strictMcpConfig,
				systemPrompt,
				appendSystemPrompt,
				taskListId,
				thinkingConfig,
				...(uploaderReady && {
					onTurnComplete: (messages: MessageType[]) => {
						void uploaderReady.then((uploader) =>
							uploader?.(messages),
						);
					},
					}),
				};

			// Shared context for processResumedConversation calls
			const resumeContext = {
				modeApi: coordinatorModeModule,
				mainThreadAgentDefinition,
				agentDefinitions,
				currentCwd,
				cliAgents,
				initialState,
			};

			if (options.continue) {
				// Continue the most recent conversation directly
				let resumeSucceeded = false;
				try {
					const resumeStart = performance.now();

					// Clear stale caches before resuming to ensure fresh file/skill discovery
					const { clearSessionCaches } =
						await import("../../../../src/commands/clear/caches.js");
					clearSessionCaches();

					const result = await loadConversationForResume(
						undefined /* sessionId */,
						undefined /* sourceFile */,
					);
					if (!result) {
						logEvent("tengu_continue", {
							success: false,
						});
						return await exitWithError(
							root,
							"No conversation found to continue",
						);
					}

					const loaded = await processResumedConversation(
						result,
						{
							forkSession: !!options.forkSession,
							includeAttribution: true,
							transcriptPath: result.fullPath,
						},
						resumeContext,
					);

					if (loaded.restoredAgentDef) {
						mainThreadAgentDefinition = loaded.restoredAgentDef;
					}

					maybeActivateProactive(options);
					maybeActivateBrief(options);

					logEvent("tengu_continue", {
						success: true,
						resume_duration_ms: Math.round(
							performance.now() - resumeStart,
						),
					});
					resumeSucceeded = true;

					await launchInteractiveSession(
						loaded.initialState,
						{
							...sessionConfig,
							mainThreadAgentDefinition:
								loaded.restoredAgentDef ??
								mainThreadAgentDefinition,
							initialMessages: loaded.messages,
							initialFileHistorySnapshots:
								loaded.fileHistorySnapshots,
							initialContentReplacements:
								loaded.contentReplacements,
							initialAgentName: loaded.agentName,
							initialAgentColor: loaded.agentColor,
						},
					);
				} catch (error) {
					if (!resumeSucceeded) {
						logEvent("tengu_continue", {
							success: false,
						});
					}
					logError(error);
					process.exit(1);
				}
			} else if (feature("DIRECT_CONNECT") && _pendingConnect?.url) {
				// `claude connect <url>` — full interactive TUI connected to a remote server
				let directConnectConfig;
				try {
					const session = await createDirectConnectSession({
						serverUrl: _pendingConnect.url,
						authToken: _pendingConnect.authToken,
						cwd: getOriginalCwd(),
						dangerouslySkipPermissions:
							_pendingConnect.dangerouslySkipPermissions,
					});
					if (session.workDir) {
						setOriginalCwd(session.workDir);
						setCwdState(session.workDir);
					}
					setDirectConnectServerUrl(_pendingConnect.url);
					directConnectConfig = session.config;
				} catch (err) {
					return await exitWithError(
						root,
						err instanceof DirectConnectError
							? err.message
							: String(err),
						() => gracefulShutdown(1),
					);
				}

				const connectInfoMessage = createSystemMessage(
					`Connected to server at ${_pendingConnect.url}\nSession: ${directConnectConfig.sessionId}`,
					"info",
				);

				await launchInteractiveSession(
					initialState,
					{
						debug: debug || debugToStderr,
						commands,
						initialTools: [],
						initialMessages: [connectInfoMessage],
						mcpClients: [],
						autoConnectIdeFlag: ide,
						mainThreadAgentDefinition,
						disableSlashCommands,
						directConnectConfig,
						thinkingConfig,
					},
				);
				return;
			} else if (feature("SSH_REMOTE") && _pendingSSH?.host) {
				// `claude ssh <host> [dir]` — probe remote, deploy binary if needed,
				// spawn ssh with unix-socket -R forward to a local auth proxy, hand
				// the REPL an SSHSession. Tools run remotely, UI renders locally.
				// `--local` skips probe/deploy/ssh and spawns the current binary
				// directly with the same env — e2e test of the proxy/auth plumbing.
				const {
					createSSHSession,
					createLocalSSHSession,
					SSHSessionError,
				} = await import("../../../../src/ssh/createSSHSession.js");
				let sshSession;
				try {
					if (_pendingSSH.local) {
						process.stderr.write(
							"Starting local ssh-proxy test session...\n",
						);
						sshSession = createLocalSSHSession({
							cwd: _pendingSSH.cwd,
							permissionMode: _pendingSSH.permissionMode,
							dangerouslySkipPermissions:
								_pendingSSH.dangerouslySkipPermissions,
						});
					} else {
						process.stderr.write(
							`Connecting to ${_pendingSSH.host}…\n`,
						);
						// In-place progress: \r + EL0 (erase to end of line). Final \n on
						// success so the next message lands on a fresh line. No-op when
						// stderr isn't a TTY (piped/redirected) — \r would just emit noise.
						const isTTY = process.stderr.isTTY;
						let hadProgress = false;
						sshSession = await createSSHSession(
							{
								host: _pendingSSH.host,
								cwd: _pendingSSH.cwd,
								localVersion: MACRO.VERSION,
								permissionMode: _pendingSSH.permissionMode,
								dangerouslySkipPermissions:
									_pendingSSH.dangerouslySkipPermissions,
								extraCliArgs: _pendingSSH.extraCliArgs,
							},
							isTTY
								? {
										onProgress: (msg) => {
											hadProgress = true;
											process.stderr.write(
												`\r  ${msg}\x1b[K`,
											);
										},
									}
								: {},
						);
						if (hadProgress) process.stderr.write("\n");
					}
					setOriginalCwd(sshSession.remoteCwd);
					setCwdState(sshSession.remoteCwd);
					setDirectConnectServerUrl(
						_pendingSSH.local ? "local" : _pendingSSH.host,
					);
				} catch (err) {
					return await exitWithError(
						root,
						err instanceof SSHSessionError
							? err.message
							: String(err),
						() => gracefulShutdown(1),
					);
				}

				const sshInfoMessage = createSystemMessage(
					_pendingSSH.local
						? `Local ssh-proxy test session\ncwd: ${sshSession.remoteCwd}\nAuth: unix socket → local proxy`
						: `SSH session to ${_pendingSSH.host}\nRemote cwd: ${sshSession.remoteCwd}\nAuth: unix socket -R → local proxy`,
					"info",
				);

				await launchInteractiveSession(
					initialState,
					{
						debug: debug || debugToStderr,
						commands,
						initialTools: [],
						initialMessages: [sshInfoMessage],
						mcpClients: [],
						autoConnectIdeFlag: ide,
						mainThreadAgentDefinition,
						disableSlashCommands,
						sshSession,
						thinkingConfig,
					},
				);
				return;
			} else if (
				feature("KAIROS") &&
				_pendingAssistantChat &&
				(_pendingAssistantChat.sessionId ||
					_pendingAssistantChat.discover)
			) {
				// `claude assistant [sessionId]` — REPL as a pure viewer client
				// of a remote assistant session. The agentic loop runs remotely; this
				// process streams live events and POSTs messages. History is lazy-
				// loaded by useAssistantHistory on scroll-up (no blocking fetch here).
				const { discoverAssistantSessions } =
					await import("../../../../src/assistant/sessionDiscovery.js");

				let targetSessionId = _pendingAssistantChat.sessionId;

				// Discovery flow — list bridge environments, filter sessions
				if (!targetSessionId) {
					let sessions;
					try {
						sessions = await discoverAssistantSessions();
					} catch (e) {
						return await exitWithError(
							root,
							`Failed to discover sessions: ${e instanceof Error ? e.message : e}`,
							() => gracefulShutdown(1),
						);
					}
					if (sessions.length === 0) {
						let installedDir: string | null;
						try {
							installedDir =
								await launchAssistantInstallWizard(root);
						} catch (e) {
							return await exitWithError(
								root,
								`Assistant installation failed: ${e instanceof Error ? e.message : e}`,
								() => gracefulShutdown(1),
							);
						}
						if (installedDir === null) {
							await gracefulShutdown(0);
							process.exit(0);
						}
						// The daemon needs a few seconds to spin up its worker and
						// establish a bridge session before discovery will find it.
						return await exitWithMessage(
							root,
							`Assistant installed in ${installedDir}. The daemon is starting up — run \`claude assistant\` again in a few seconds to connect.`,
							{
								exitCode: 0,
								beforeExit: () => gracefulShutdown(0),
							},
						);
					}
					if (sessions.length === 1) {
						targetSessionId = sessions[0]!.id;
					} else {
						const picked = await launchAssistantSessionChooser(
							root,
							{
								sessions,
							},
						);
						if (!picked) {
							await gracefulShutdown(0);
							process.exit(0);
						}
						targetSessionId = picked;
					}
				}

				// Auth — call prepareApiRequest() once for orgUUID, but use a
				// getAccessToken closure for the token so reconnects get fresh tokens.
				const {
					checkAndRefreshOAuthTokenIfNeeded,
					getClaudeAIOAuthTokens,
				} = await import("../../../../src/utils/auth.js");
				await checkAndRefreshOAuthTokenIfNeeded();
				let apiCreds;
				try {
					apiCreds = await prepareApiRequest();
				} catch (e) {
					return await exitWithError(
						root,
						`Error: ${e instanceof Error ? e.message : "Failed to authenticate"}`,
						() => gracefulShutdown(1),
					);
				}
				const getAccessToken = (): string =>
					getClaudeAIOAuthTokens()?.accessToken ??
					apiCreds.accessToken;

				// Brief mode activation: setKairosActive(true) satisfies BOTH opt-in
				// and entitlement for isBriefEnabled() (BriefTool.ts:124-132).
				setKairosActive(true);
				setUserMsgOptIn(true);
				setIsRemoteMode(true);

				const remoteSessionConfig = createRemoteSessionConfig(
					targetSessionId,
					getAccessToken,
					apiCreds.orgUUID,
					/* hasInitialPrompt */ false,
					/* viewerOnly */ true,
				);

				const infoMessage = createSystemMessage(
					`Attached to assistant session ${targetSessionId.slice(0, 8)}…`,
					"info",
				);

				const assistantInitialState: AppState = {
					...initialState,
					isBriefOnly: true,
					kairosEnabled: false,
					replBridgeEnabled: false,
				};

				const remoteCommands = filterCommandsForRemoteMode(commands);
				await launchInteractiveSession(
					assistantInitialState,
					{
						debug: debug || debugToStderr,
						commands: remoteCommands,
						initialTools: [],
						initialMessages: [infoMessage],
						mcpClients: [],
						autoConnectIdeFlag: ide,
						mainThreadAgentDefinition,
						disableSlashCommands,
						remoteSessionConfig,
						thinkingConfig,
					},
				);
				return;
			} else if (
				options.resume ||
				options.fromPr ||
				teleport ||
				remote !== null
			) {
				// Handle resume flow - from file (ant-only), session ID, or interactive selector

				// Clear stale caches before resuming to ensure fresh file/skill discovery
				const { clearSessionCaches } =
					await import("../../../../src/commands/clear/caches.js");
				clearSessionCaches();

				let messages: MessageType[] | null = null;
				let processedResume: ProcessedResume | undefined;

				let maybeSessionId = validateUuid(options.resume);
				let searchTerm: string | undefined;
				// Store full LogOption when found by custom title (for cross-worktree resume)
				let matchedLog: LogOption | null = null;
				// PR filter for --from-pr flag
				let filterByPr: boolean | number | string | undefined;

				// Handle --from-pr flag
				if (options.fromPr) {
					if (options.fromPr === true) {
						// Show all sessions with linked PRs
						filterByPr = true;
					} else if (typeof options.fromPr === "string") {
						// Could be a PR number or URL
						filterByPr = options.fromPr;
					}
				}

				// If resume value is not a UUID, try exact match by custom title first
				if (
					options.resume &&
					typeof options.resume === "string" &&
					!maybeSessionId
				) {
					const trimmedValue = options.resume.trim();
					if (trimmedValue) {
						const matches = await searchSessionsByCustomTitle(
							trimmedValue,
							{
								exact: true,
							},
						);

						if (matches.length === 1) {
							// Exact match found - store full LogOption for cross-worktree resume
							matchedLog = matches[0]!;
							maybeSessionId =
								getSessionIdFromLog(matchedLog) ?? null;
						} else {
							// No match or multiple matches - use as search term for picker
							searchTerm = trimmedValue;
						}
					}
				}

				// --remote and --teleport both create/resume Claude Code Web (CCR) sessions.
				// Remote Control (--rc) is a separate feature gated in initReplBridge.ts.
				if (remote !== null || teleport) {
					await waitForPolicyLimitsToLoad();
					if (!isPolicyAllowed("allow_remote_sessions")) {
						return await exitWithError(
							root,
							"Error: Remote sessions are disabled by your organization's policy.",
							() => gracefulShutdown(1),
						);
					}
				}

				if (remote !== null) {
					// Create remote session (optionally with initial prompt)
					const hasInitialPrompt = remote.length > 0;

					// Check if TUI mode is enabled - description is only optional in TUI mode
					const isRemoteTuiEnabled =
						getFeatureValue_CACHED_MAY_BE_STALE(
							"tengu_remote_backend",
							false,
						);
					if (!isRemoteTuiEnabled && !hasInitialPrompt) {
						return await exitWithError(
							root,
							'Error: --remote requires a description.\nUsage: claude --remote "your task description"',
							() => gracefulShutdown(1),
						);
					}

					logEvent("tengu_remote_create_session", {
						has_initial_prompt: String(
							hasInitialPrompt,
						) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
					});

					// Pass current branch so CCR clones the repo at the right revision
					const currentBranch = await getBranch();
					const createdSession =
						await teleportToRemoteWithErrorHandling(
							root,
							hasInitialPrompt ? remote : null,
							new AbortController().signal,
							currentBranch || undefined,
						);
					if (!createdSession) {
						logEvent("tengu_remote_create_session_error", {
							error: "unable_to_create_session" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
						});
						return await exitWithError(
							root,
							"Error: Unable to create remote session",
							() => gracefulShutdown(1),
						);
					}
					logEvent("tengu_remote_create_session_success", {
						session_id:
							createdSession.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
					});

					// Check if new remote TUI mode is enabled via feature gate
					if (!isRemoteTuiEnabled) {
						// Original behavior: print session info and exit
						process.stdout.write(
							`Created remote session: ${createdSession.title}\n`,
						);
						process.stdout.write(
							`View: ${getRemoteSessionUrl(createdSession.id)}?m=0\n`,
						);
						process.stdout.write(
							`Resume with: claude --teleport ${createdSession.id}\n`,
						);
						await gracefulShutdown(0);
						process.exit(0);
					}

					// New behavior: start local TUI with CCR engine
					// Mark that we're in remote mode for command visibility
					setIsRemoteMode(true);
					switchSession(asSessionId(createdSession.id));

					// Get OAuth credentials for remote session
					let apiCreds: { accessToken: string; orgUUID: string };
					try {
						apiCreds = await prepareApiRequest();
					} catch (error) {
						logError(toError(error));
						return await exitWithError(
							root,
							`Error: ${errorMessage(error) || "Failed to authenticate"}`,
							() => gracefulShutdown(1),
						);
					}

					// Create remote session config for the REPL
					const { getClaudeAIOAuthTokens: getTokensForRemote } =
						await import("../../../../src/utils/auth.js");
					const getAccessTokenForRemote = (): string =>
						getTokensForRemote()?.accessToken ??
						apiCreds.accessToken;
					const remoteSessionConfig = createRemoteSessionConfig(
						createdSession.id,
						getAccessTokenForRemote,
						apiCreds.orgUUID,
						hasInitialPrompt,
					);

					// Add remote session info as initial system message
					const remoteSessionUrl = `${getRemoteSessionUrl(createdSession.id)}?m=0`;
					const remoteInfoMessage = createSystemMessage(
						`/remote-control is active. Code in CLI or at ${remoteSessionUrl}`,
						"info",
					);

					// Create initial user message from the prompt if provided (CCR echoes it back but we ignore that)
					const initialUserMessage = hasInitialPrompt
						? createUserMessage({ content: remote })
						: null;

					// Set remote session URL in app state for footer indicator
					const remoteInitialState = {
						...initialState,
						remoteSessionUrl,
					};

					// Pre-filter commands to only include remote-safe ones.
					// CCR's init response may further refine the list (via handleRemoteInit in REPL).
					const remoteCommands =
						filterCommandsForRemoteMode(commands);
					await launchInteractiveSession(
						remoteInitialState,
						{
							debug: debug || debugToStderr,
							commands: remoteCommands,
							initialTools: [],
							initialMessages: initialUserMessage
								? [remoteInfoMessage, initialUserMessage]
								: [remoteInfoMessage],
							mcpClients: [],
							autoConnectIdeFlag: ide,
							mainThreadAgentDefinition,
							disableSlashCommands,
							remoteSessionConfig,
							thinkingConfig,
						},
					);
					return;
				} else if (teleport) {
					if (teleport === true || teleport === "") {
						// Interactive mode: show task selector and handle resume
						logEvent("tengu_teleport_interactive_mode", {});
						logForDebugging(
							"selectAndResumeTeleportTask: Starting teleport flow...",
						);
						const teleportResult =
							await launchTeleportResumeWrapper(root);
						if (!teleportResult) {
							// User cancelled or error occurred
							await gracefulShutdown(0);
							process.exit(0);
						}
						const { branchError } =
							await checkOutTeleportedSessionBranch(
								teleportResult.branch,
							);
						messages = processMessagesForTeleportResume(
							teleportResult.log,
							branchError,
						);
					} else if (typeof teleport === "string") {
						logEvent("tengu_teleport_resume_session", {
							mode: "direct" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
						});
						try {
							// First, fetch session and validate repository before checking git state
							const sessionData = await fetchSession(teleport);
							const repoValidation =
								await validateSessionRepository(sessionData);

							// Handle repo mismatch or not in repo cases
							if (
								repoValidation.status === "mismatch" ||
								repoValidation.status === "not_in_repo"
							) {
								const sessionRepo = repoValidation.sessionRepo;
								if (sessionRepo) {
									// Check for known paths
									const knownPaths =
										getKnownPathsForRepo(sessionRepo);
									const existingPaths =
										await filterExistingPaths(knownPaths);

									if (existingPaths.length > 0) {
										// Show directory switch dialog
										const selectedPath =
											await launchTeleportRepoMismatchDialog(
												root,
												{
													targetRepo: sessionRepo,
													initialPaths: existingPaths,
												},
											);

										if (selectedPath) {
											// Change to the selected directory
											process.chdir(selectedPath);
											setCwd(selectedPath);
											setOriginalCwd(selectedPath);
										} else {
											// User cancelled
											await gracefulShutdown(0);
										}
									} else {
										// No known paths - show original error
										throw new TeleportOperationError(
											`You must run claude --teleport ${teleport} from a checkout of ${sessionRepo}.`,
											chalk.red(
												`You must run claude --teleport ${teleport} from a checkout of ${chalk.bold(sessionRepo)}.\n`,
											),
										);
									}
								}
							} else if (repoValidation.status === "error") {
								throw new TeleportOperationError(
									repoValidation.errorMessage ||
										"Failed to validate session",
									chalk.red(
										`Error: ${repoValidation.errorMessage || "Failed to validate session"}\n`,
									),
								);
							}

							await validateGitState();

							// Use progress UI for teleport
							const { teleportWithProgress } =
								await import("../../../../src/components/TeleportProgress.js");
							const result = await teleportWithProgress(
								root,
								teleport,
							);
							// Track teleported session for reliability logging
							setTeleportedSessionInfo({ sessionId: teleport });
							messages = result.messages;
						} catch (error) {
							if (error instanceof TeleportOperationError) {
								process.stderr.write(
									error.formattedMessage + "\n",
								);
							} else {
								logError(error);
								process.stderr.write(
									chalk.red(
										`Error: ${errorMessage(error)}\n`,
									),
								);
							}
							await gracefulShutdown(1);
						}
					}
				}
				if (process.env.USER_TYPE === "ant") {
					if (
						options.resume &&
						typeof options.resume === "string" &&
						!maybeSessionId
					) {
						// Check for ccshare URL (e.g. https://go/ccshare/boris-20260311-211036)
						const { parseCcshareId, loadCcshare } =
							await import("../../../../src/utils/ccshareResume.js");
						const ccshareId = parseCcshareId(options.resume);
						if (ccshareId) {
							try {
								const resumeStart = performance.now();
								const logOption = await loadCcshare(ccshareId);
								const result = await loadConversationForResume(
									logOption,
									undefined,
								);
								if (result) {
									processedResume =
										await processResumedConversation(
											result,
											{
												forkSession: true,
												transcriptPath: result.fullPath,
											},
											resumeContext,
										);
									if (processedResume.restoredAgentDef) {
										mainThreadAgentDefinition =
											processedResume.restoredAgentDef;
									}
									logEvent("tengu_session_resumed", {
										entrypoint:
											"ccshare" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
										success: true,
										resume_duration_ms: Math.round(
											performance.now() - resumeStart,
										),
									});
								} else {
									logEvent("tengu_session_resumed", {
										entrypoint:
											"ccshare" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
										success: false,
									});
								}
							} catch (error) {
								logEvent("tengu_session_resumed", {
									entrypoint:
										"ccshare" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
									success: false,
								});
								logError(error);
								await exitWithError(
									root,
									`Unable to resume from ccshare: ${errorMessage(error)}`,
									() => gracefulShutdown(1),
								);
							}
						} else {
							const resolvedPath = resolve(options.resume);
							try {
								const resumeStart = performance.now();
								let logOption;
								try {
									// Attempt to load as a transcript file; ENOENT falls through to session-ID handling
									logOption =
										await loadTranscriptFromFile(
											resolvedPath,
										);
								} catch (error) {
									if (!isENOENT(error)) throw error;
									// ENOENT: not a file path — fall through to session-ID handling
								}
								if (logOption) {
									const result =
										await loadConversationForResume(
											logOption,
											undefined /* sourceFile */,
										);
									if (result) {
										processedResume =
											await processResumedConversation(
												result,
												{
													forkSession:
														!!options.forkSession,
													transcriptPath:
														result.fullPath,
												},
												resumeContext,
											);
										if (processedResume.restoredAgentDef) {
											mainThreadAgentDefinition =
												processedResume.restoredAgentDef;
										}
										logEvent("tengu_session_resumed", {
											entrypoint:
												"file" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
											success: true,
											resume_duration_ms: Math.round(
												performance.now() - resumeStart,
											),
										});
									} else {
										logEvent("tengu_session_resumed", {
											entrypoint:
												"file" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
											success: false,
										});
									}
								}
							} catch (error) {
								logEvent("tengu_session_resumed", {
									entrypoint:
										"file" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
									success: false,
								});
								logError(error);
								await exitWithError(
									root,
									`Unable to load transcript from file: ${options.resume}`,
									() => gracefulShutdown(1),
								);
							}
						}
					}
				}

				// If not loaded as a file, try as session ID
				if (maybeSessionId) {
					// Resume specific session by ID
					const sessionId = maybeSessionId;
					try {
						const resumeStart = performance.now();
						// Use matchedLog if available (for cross-worktree resume by custom title)
						// Otherwise fall back to sessionId string (for direct UUID resume)
						const result = await loadConversationForResume(
							matchedLog ?? sessionId,
							undefined,
						);

						if (!result) {
							logEvent("tengu_session_resumed", {
								entrypoint:
									"cli_flag" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
								success: false,
							});
							return await exitWithError(
								root,
								`No conversation found with session ID: ${sessionId}`,
							);
						}

						const fullPath =
							matchedLog?.fullPath ?? result.fullPath;
						processedResume = await processResumedConversation(
							result,
							{
								forkSession: !!options.forkSession,
								sessionIdOverride: sessionId,
								transcriptPath: fullPath,
							},
							resumeContext,
						);

						if (processedResume.restoredAgentDef) {
							mainThreadAgentDefinition =
								processedResume.restoredAgentDef;
						}
						logEvent("tengu_session_resumed", {
							entrypoint:
								"cli_flag" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
							success: true,
							resume_duration_ms: Math.round(
								performance.now() - resumeStart,
							),
						});
					} catch (error) {
						logEvent("tengu_session_resumed", {
							entrypoint:
								"cli_flag" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
							success: false,
						});
						logError(error);
						await exitWithError(
							root,
							`Failed to resume session ${sessionId}`,
						);
					}
				}

					// Await file downloads before rendering REPL (files must be available)
					if (fileDownloadPromise) {
						try {
							const results = await fileDownloadPromise;
							const failedCount = count(results, (r) => !r.success);
						if (failedCount > 0) {
							process.stderr.write(
								chalk.yellow(
									`Warning: ${failedCount}/${results.length} file(s) failed to download.\n`,
								),
							);
						}
					} catch (error) {
						return await exitWithError(
							root,
							`Error downloading files: ${errorMessage(error)}`,
						);
					}
				}

					// If we have a processed resume or teleport messages, render the REPL
					const resumeData =
					processedResume ??
					(Array.isArray(messages)
						? {
								messages,
								fileHistorySnapshots: undefined,
								agentName: undefined,
								agentColor: undefined as
									| AgentColorName
									| undefined,
								restoredAgentDef: mainThreadAgentDefinition,
								initialState,
								contentReplacements: undefined,
							}
						: undefined);
				if (resumeData) {
					maybeActivateProactive(options);
					maybeActivateBrief(options);

					await launchInteractiveSession(
						resumeData.initialState,
						{
							...sessionConfig,
							mainThreadAgentDefinition:
								resumeData.restoredAgentDef ??
								mainThreadAgentDefinition,
							initialMessages: resumeData.messages,
							initialFileHistorySnapshots:
								resumeData.fileHistorySnapshots,
							initialContentReplacements:
								resumeData.contentReplacements,
							initialAgentName: resumeData.agentName,
							initialAgentColor: resumeData.agentColor,
						},
					);
				} else {
					// Show interactive selector (includes same-repo worktrees)
					// Note: ResumeConversation loads logs internally to ensure proper GC after selection
					await launchResumeChooser(
						root,
						{ getFpsMetrics, stats, initialState },
						getWorktreePaths(getOriginalCwd()),
						{
							...sessionConfig,
							initialSearchQuery: searchTerm,
							forkSession: options.forkSession,
							filterByPr,
						},
					);
				}
					} else {
						// Pass unresolved hooks promise to REPL so it can render immediately
				// instead of blocking ~500ms waiting for SessionStart hooks to finish.
				// REPL will inject hook messages when they resolve and await them before
				// the first API call so the model always sees hook context.
				const pendingHookMessages =
					hooksPromise && hookMessages.length === 0
						? hooksPromise
						: undefined;

				profileCheckpoint("action_after_hooks");
				maybeActivateProactive(options);
				maybeActivateBrief(options);
				// Persist the current mode for fresh sessions so future resumes know what mode was used
				if (feature("COORDINATOR_MODE")) {
					saveMode(
						coordinatorModeModule?.isCoordinatorMode()
							? "coordinator"
							: "normal",
					);
				}

				// If launched via a deep link, show a provenance banner so the user
				// knows the session originated externally. Linux xdg-open and
				// browsers with "always allow" set dispatch the link with no OS-level
				// confirmation, so this is the only signal the user gets that the
				// prompt — and the working directory / CLAUDE.md it implies — came
				// from an external source rather than something they typed.
				let deepLinkBanner: ReturnType<
					typeof createSystemMessage
				> | null = null;
				if (feature("LODESTONE")) {
					if (options.deepLinkOrigin) {
						logEvent("tengu_deep_link_opened", {
							has_prefill: Boolean(options.prefill),
							has_repo: Boolean(options.deepLinkRepo),
						});
						deepLinkBanner = createSystemMessage(
							buildDeepLinkBanner({
								cwd: getCwd(),
								prefillLength: options.prefill?.length,
								repo: options.deepLinkRepo,
								lastFetch:
									options.deepLinkLastFetch !== undefined
										? new Date(options.deepLinkLastFetch)
										: undefined,
							}),
							"warning",
						);
					} else if (options.prefill) {
						deepLinkBanner = createSystemMessage(
							"Launched with a pre-filled prompt — review it before pressing Enter.",
							"warning",
						);
					}
				}
				const initialMessages = deepLinkBanner
					? [deepLinkBanner, ...hookMessages]
					: hookMessages.length > 0
						? hookMessages
						: undefined;

				await launchInteractiveSession(
					initialState,
					{
						...sessionConfig,
						initialMessages,
						pendingHookMessages,
					},
				);
			}
}

// Moved from src/main.tsx along with the rest of the .action() body at commit
// 903c46b. The original extraction left the function definition behind while
// relocating every caller into this file, producing a silent runtime crash
// (ReferenceError swallowed by Ink's patchConsole) that blanked the REPL.
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
	hasInitialPrompt: boolean
	hasStdin: boolean
	verbose: boolean
	debug: boolean
	debugToStderr: boolean
	print: boolean
	outputFormat: string
	inputFormat: string
	numAllowedTools: number
	numDisallowedTools: number
	mcpClientCount: number
	worktreeEnabled: boolean
	skipWebFetchPreflight: boolean | undefined
	githubActionInputs: string | undefined
	dangerouslySkipPermissionsPassed: boolean
	permissionMode: string
	modeIsBypass: boolean
	allowDangerouslySkipPermissionsPassed: boolean
	systemPromptFlag: 'file' | 'flag' | undefined
	appendSystemPromptFlag: 'file' | 'flag' | undefined
	thinkingConfig: ThinkingConfig
	assistantActivationPath: string | undefined
}): Promise<void> {
	try {
		logEvent('tengu_init', {
			entrypoint:
				'claude' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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
				feature('COORDINATOR_MODE') &&
				coordinatorModeModule?.isCoordinatorMode()
					? true
					: undefined,
			...(assistantActivationPath && {
				assistantActivationPath:
					assistantActivationPath as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			}),
			autoUpdatesChannel: (getInitialSettings().autoUpdatesChannel ??
				'latest') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			...(process.env.USER_TYPE === 'ant'
				? (() => {
						const cwd = getCwd()
						const gitRoot = findGitRoot(cwd)
						const rp = gitRoot ? relative(gitRoot, cwd) || '.' : undefined
						return rp
							? {
									relativeProjectPath:
										rp as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
								}
							: {}
					})()
				: {}),
		})
	} catch (error) {
		logError(error)
	}
}
