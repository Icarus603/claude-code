import {
  installPackageHostBindings as installPackageHostBindingsFromAppHost,
  type PackageHostBindingInstallers,
} from '@claude-code/app-host/packageHostSetup'
import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { findCanonicalGitRoot } from '../utils/git.js'
import { getCwd } from '../utils/cwd.js'

export function installPackageHostBindings(
  installers: PackageHostBindingInstallers = {},
): void {
  installPackageHostBindingsFromAppHost(
    {
      getConfigHomeDir: () => getClaudeConfigHomeDir(),
      getProjectRoot: () => findCanonicalGitRoot(getCwd()),
      // V7 §8.6 — auth bridge for settings sync
      getSettingsSyncAuth: () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getAPIProvider, isFirstPartyAnthropicBaseUrl } = require('../utils/model/providers.js') as typeof import('../utils/model/providers.js')
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getClaudeAIOAuthTokens, checkAndRefreshOAuthTokenIfNeeded } = require('../utils/auth.js') as typeof import('../utils/auth.js')
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { CLAUDE_AI_INFERENCE_SCOPE, getOauthConfig, OAUTH_BETA_HEADER } = require('../constants/oauth.js') as typeof import('../constants/oauth.js')
          if (getAPIProvider() !== 'firstParty' || !isFirstPartyAnthropicBaseUrl()) return null
          const tokens = getClaudeAIOAuthTokens()
          const isEligible = Boolean(tokens?.accessToken && tokens.scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE))
          return {
            isEligible,
            baseApiUrl: getOauthConfig().BASE_API_URL,
            getAuthHeaders: async () => {
              // Try API key first (Console users), then OAuth (Claude.ai users)
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { getAnthropicApiKeyWithSource } = require('../utils/auth.js') as typeof import('../utils/auth.js')
                const { key } = getAnthropicApiKeyWithSource({ skipRetrievingKeyFromApiKeyHelper: true })
                if (key) return { 'x-api-key': key }
              } catch { /* no API key */ }
              const t = getClaudeAIOAuthTokens()
              if (t?.accessToken) return { Authorization: `Bearer ${t.accessToken}`, 'anthropic-beta': OAUTH_BETA_HEADER }
              return {}
            },
            refreshToken: () => checkAndRefreshOAuthTokenIfNeeded(),
          }
        } catch { return null }
      },
      isInteractive: () => { try { return (require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')).getIsInteractive() } catch { return false } },
      clearMemoryFileCaches: () => { try { (require('../utils/claudemd.js') as typeof import('../utils/claudemd.js')).clearMemoryFileCaches() } catch {} },
      getRepoRemoteHash: async () => { try { return await (require('../utils/git.js') as typeof import('../utils/git.js')).getRepoRemoteHash() } catch { return null } },
      logDebug: (message, metadata) => logForDebugging(message, metadata as any),
      now: () => Date.now(),
      // V7 — extra subsystem bindings. ALL require() from src/ stays HERE
      // (never in packages/app-host/src/ — see memory: no-require-in-apphost)
      extraPermissionBindings: {
        addPermissionRulesToSettings: (...a: unknown[]) => { try { return require('../utils/permissions/permissionsLoader.js').addPermissionRulesToSettings(...a) } catch { return false } },
        getOriginalCwd: () => { try { return require('../bootstrap/state.js').getOriginalCwd() } catch { return process.cwd() } },
        getSessionId: () => { try { return require('../bootstrap/state.js').getSessionId() } catch { return 'unknown' } },
        getCwd: () => { try { return require('../utils/cwd.js').getCwd() } catch { return process.cwd() } },
        getConfigHomeDir: () => getClaudeConfigHomeDir(),
        getFsImplementation: () => { try { return require('../utils/fsOperations.js').getFsImplementation() } catch { return require('node:fs') } },
        getPathsForPermissionCheck: (...a: unknown[]) => { try { return require('../utils/fsOperations.js').getPathsForPermissionCheck(...a) } catch { return [] } },
        containsPathTraversal: (p: string) => { try { return require('../utils/path.js').containsPathTraversal(p) } catch { return false } },
        expandPath: (p: string, cwd: string) => { try { return require('../utils/path.js').expandPath(p, cwd) } catch { return p } },
        getDirectoryForPath: (p: string) => { try { return require('../utils/path.js').getDirectoryForPath(p) } catch { return p } },
        sanitizePath: (p: string) => { try { return require('../utils/path.js').sanitizePath(p) } catch { return p } },
        getPlanSlug: () => { try { return require('../utils/plans.js').getPlanSlug() } catch { return undefined } },
        getPlansDirectory: () => { try { return require('../utils/plans.js').getPlansDirectory() } catch { return '' } },
        getPlatform: () => { try { return require('../utils/platform.js').getPlatform() } catch { return process.platform === 'darwin' ? 'macos' : 'linux' } },
        getProjectDir: (...a: unknown[]) => { try { return require('../utils/sessionStorage.js').getProjectDir(...a) } catch { return process.cwd() } },
        containsVulnerableUncPath: (p: string) => { try { return require('../utils/shell/readOnlyCommandValidation.js').containsVulnerableUncPath(p) } catch { return false } },
        getToolResultsDir: () => { try { return require('../utils/toolResultStorage.js').getToolResultsDir() } catch { return '' } },
        // permissions.ts bindings
        shouldUseSandbox: () => { try { return require('../tools/BashTool/shouldUseSandbox.js').shouldUseSandbox() } catch { return false } },
        extractOutputRedirections: (cmd: string) => { try { return require('../utils/bash/commands.js').extractOutputRedirections(cmd) } catch { return [] } },
        deletePermissionRuleFromSettings: (...a: unknown[]) => { try { return require('../utils/permissions/permissionsLoader.js').deletePermissionRuleFromSettings(...a) } catch { return false } },
        shouldAllowManagedPermissionRulesOnly: () => { try { return require('../utils/permissions/permissionsLoader.js').shouldAllowManagedPermissionRulesOnly() } catch { return false } },
        classifyPermissionDecision: (...a: unknown[]) => { try { return require('../utils/permissions/classifierDecision.js').classifyPermissionDecision(...a) } catch { return null } },
        getAutoMode: () => { try { return require('../utils/permissions/autoModeState.js').getAutoMode() } catch { return null } },
        setAutoMode: (v: unknown) => { try { require('../utils/permissions/autoModeState.js').setAutoMode(v) } catch {} },
        setDirtyAutoMode: () => { try { require('../utils/permissions/autoModeState.js').setDirtyAutoMode() } catch {} },
        clearDirtyAutoMode: () => { try { require('../utils/permissions/autoModeState.js').clearDirtyAutoMode() } catch {} },
        addToTurnClassifierDuration: (ms: number) => { try { require('../bootstrap/state.js').addToTurnClassifierDuration(ms) } catch {} },
        getTotalInputTokens: () => { try { return require('../bootstrap/state.js').getTotalInputTokens() } catch { return 0 } },
        getTotalOutputTokens: () => { try { return require('../bootstrap/state.js').getTotalOutputTokens() } catch { return 0 } },
        getTotalCacheCreationInputTokens: () => { try { return require('../bootstrap/state.js').getTotalCacheCreationInputTokens() } catch { return 0 } },
        getTotalCacheReadInputTokens: () => { try { return require('../bootstrap/state.js').getTotalCacheReadInputTokens() } catch { return 0 } },
        logEvent: (event: string, metadata?: Record<string, unknown>) => { try { (require('@claude-code/local-observability') as typeof import('@claude-code/local-observability')).logEvent(event, metadata) } catch {} },
        sanitizeToolNameForAnalytics: (name: string) => { try { return require('../services/eventMetadata.js').sanitizeToolNameForAnalytics(name) } catch { return name } },
        clearClassifierChecking: () => { try { require('../utils/classifierApprovals.js').clearClassifierChecking() } catch {} },
        setClassifierChecking: (v: boolean) => { try { require('../utils/classifierApprovals.js').setClassifierChecking(v) } catch {} },
        isInProtectedNamespace: () => { try { return require('../utils/envUtils.js').isInProtectedNamespace() } catch { return false } },
        executePermissionRequestHooks: (...a: unknown[]) => { try { return require('../utils/hooks.js').executePermissionRequestHooks(...a) } catch { return Promise.resolve(null) } },
        buildClassifierUnavailableMessage: () => { try { return require('../utils/messages.js').buildClassifierUnavailableMessage() } catch { return '' } },
        buildYoloRejectionMessage: (...a: unknown[]) => { try { return require('../utils/messages.js').buildYoloRejectionMessage(...a) } catch { return '' } },
        calculateCostFromTokens: (...a: unknown[]) => { try { return require('../utils/modelCost.js').calculateCostFromTokens(...a) } catch { return 0 } },
        isSandboxingEnabled: () => { try { return require('../utils/sandbox/sandbox-adapter.js').SandboxManager.isSandboxingEnabled() } catch { return false } },
        isAutoAllowBashIfSandboxedEnabled: () => { try { return require('../utils/sandbox/sandbox-adapter.js').SandboxManager.isAutoAllowBashIfSandboxedEnabled() } catch { return false } },
        classifyYoloAction: (...a: unknown[]) => { try { return require('../utils/permissions/yoloClassifier.js').classifyYoloAction(...a) } catch { return null } },
        formatActionForClassifier: (...a: unknown[]) => { try { return require('../utils/permissions/yoloClassifier.js').formatActionForClassifier(...a) } catch { return '' } },
        getToolsForDefaultPreset: () => { try { return require("../tools.js").getToolsForDefaultPreset() } catch { return [] } },
        handleAutoModeTransition: (mode) => { try { require('../bootstrap/state.js').handleAutoModeTransition(mode) } catch {} },
        handlePlanModeTransition: (mode) => { try { require('../bootstrap/state.js').handlePlanModeTransition(mode) } catch {} },
        setHasExitedPlanMode: (v) => { try { require('../bootstrap/state.js').setHasExitedPlanMode(v) } catch {} },
        setNeedsAutoModeExitAttachment: (v) => { try { require('../bootstrap/state.js').setNeedsAutoModeExitAttachment(v) } catch {} },
        loadAllPermissionRulesFromDisk: () => { try { return require('../utils/permissions/permissionsLoader.js').loadAllPermissionRulesFromDisk() } catch { return [] } },
        addDirHelpMessage: () => { try { return require('../commands/add-dir/validation.js').addDirHelpMessage() } catch { return '' } },
        validateDirectoryForWorkspace: (dir, cwd) => { try { return require('../commands/add-dir/validation.js').validateDirectoryForWorkspace(dir, cwd) } catch { return { valid: true } } },
        parseToolPreset: (preset) => { try { return require('../tools.js').parseToolPreset(preset) } catch { return [] } },
        safeResolvePath: (fs, p) => { try { return require('../utils/fsOperations.js').safeResolvePath(fs, p) } catch { return { resolvedPath: p } } },
        modelSupportsAutoMode: (model) => { try { return require('../utils/betas.js').modelSupportsAutoMode(model) } catch { return false } },
        gracefulShutdown: (code) => { try { return require('../utils/gracefulShutdown.js').gracefulShutdown(code) } catch { return Promise.reject() } },
        getMainLoopModel: () => { try { return require('../utils/model/model.js').getMainLoopModel() } catch { return '' } },
      },
      extraAgentBindings: {
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
      },
      // V7 §7 — bootstrap state + session accessors for config
      getCwd: () => { try { return require('../utils/cwd.js').getCwd() } catch { return process.cwd() } },
      getOriginalCwd: () => { try { return require('../bootstrap/state.js').getOriginalCwd() } catch { return process.cwd() } },
      getSessionTrustAccepted: () => { try { return require('../bootstrap/state.js').getSessionTrustAccepted() } catch { return false } },
      getFlagSettingsPath: () => { try { return require('../bootstrap/state.js').getFlagSettingsPath() } catch { return undefined } },
      getFlagSettingsInline: () => { try { return require('../bootstrap/state.js').getFlagSettingsInline() } catch { return null } },
      getUseCoworkPlugins: () => { try { return require('../bootstrap/state.js').getUseCoworkPlugins() } catch { return false } },
      logEvent: (event: string, metadata?: Record<string, unknown>) => {
        try { (require('@claude-code/local-observability') as typeof import('@claude-code/local-observability')).logEvent(event, metadata) } catch { /* best-effort */ }
      },
      findCanonicalGitRoot: (cwd: string) => {
        try { return require('../utils/git.js').findCanonicalGitRoot(cwd) } catch { return undefined }
      },
      addFileGlobRuleToGitignore: (dir: string, glob: string) => {
        try { require('../utils/git/gitignore.js').addFileGlobRuleToGitignore(dir, glob) } catch { /* best-effort */ }
      },
      // V7 §8.6 — local-observability + profiler bindings for MDM subsystem
      logDiagnostics: (level: string, event: string, data?: Record<string, unknown>) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { logForDiagnosticsNoPII } = require('../utils/diagLogs.js') as typeof import('../utils/diagLogs.js')
          logForDiagnosticsNoPII(level as any, event, data)
        } catch { /* diagnostic logging is best-effort */ }
      },
      profileCheckpoint: (name: string) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { profileCheckpoint } = require('../utils/startupProfiler.js') as typeof import('../utils/startupProfiler.js')
          profileCheckpoint(name)
        } catch { /* profiling is optional */ }
      },
      // V7 §8.24 — managed settings security check UI (React dialog).
      checkManagedSettingsSecurity: async (cached: unknown, newSettings: unknown) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getIsInteractive } = require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
          if (!getIsInteractive()) return 'no_check_needed'
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const utils = require('../components/ManagedSettingsSecurityDialog/utils.js') as typeof import('../components/ManagedSettingsSecurityDialog/utils.js')
          if (!newSettings || !utils.hasDangerousSettings(utils.extractDangerousSettings(newSettings as any))) return 'no_check_needed'
          if (!utils.hasDangerousSettingsChanged(cached as any, newSettings as any)) return 'no_check_needed'
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { logEvent } = require('@claude-code/local-observability') as typeof import('@claude-code/local-observability')
          logEvent('tengu_managed_settings_security_dialog_shown', {})
          const React = require('react')
          const { ManagedSettingsSecurityDialog } = require('../components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.js')
          const { render } = require('../ink.js')
          const { KeybindingSetup } = require('../keybindings/KeybindingProviderSetup.js')
          const { AppStateProvider } = require('../state/AppState.js')
          const { getBaseRenderOptions } = require('../utils/renderOptions.js')
          return new Promise<'approved' | 'rejected' | 'no_check_needed'>(resolve => {
            void (async () => {
              const { unmount } = await render(
                React.createElement(AppStateProvider, null,
                  React.createElement(KeybindingSetup, null,
                    React.createElement(ManagedSettingsSecurityDialog, {
                      settings: newSettings,
                      onAccept: () => { logEvent('tengu_managed_settings_security_dialog_accepted', {}); unmount(); resolve('approved') },
                      onReject: () => { logEvent('tengu_managed_settings_security_dialog_rejected', {}); unmount(); resolve('rejected') },
                    })
                  )
                ),
                getBaseRenderOptions(false),
              )
            })()
          })
        } catch { return 'no_check_needed' }
      },
      handleSecurityCheckResult: (result: 'approved' | 'rejected' | 'no_check_needed') => {
        if (result === 'rejected') {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { gracefulShutdownSync } = require('../utils/gracefulShutdown.js') as typeof import('../utils/gracefulShutdown.js')
            gracefulShutdownSync(1)
          } catch { process.exit(1) }
          return false
        }
        return true
      },
      // V7 §8.6 — bootstrap state + lifecycle + hooks bindings for changeDetector
      getIsRemoteMode: () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getIsRemoteMode } = require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
          return getIsRemoteMode()
        } catch { return false }
      },
      registerCleanup: (fn: () => Promise<void>) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { registerCleanup } = require('../utils/cleanupRegistry.js') as typeof import('../utils/cleanupRegistry.js')
        return registerCleanup(fn)
      },
      executeConfigChangeHooks: async (source: string) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { executeConfigChangeHooks, hasBlockingResult } = require('../utils/hooks.js') as typeof import('../utils/hooks.js')
          const results = await executeConfigChangeHooks(source as any)
          return { blocked: hasBlockingResult(results) }
        } catch { return { blocked: false } }
      },
      // V7 §8.6 — bridge MCP validation errors into config without a
      // direct config → mcp-runtime dependency. Lazy-imported so the MCP
      // module tree doesn't load at config-init time.
      getMcpErrorsByScope: (scope: string) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getMcpConfigsByScope } = require('../services/mcp/config.js') as typeof import('../services/mcp/config.js')
          return getMcpConfigsByScope(scope as any).errors
        } catch {
          return []
        }
      },
      // V7 §8.6 — bridge auth/provider eligibility check into config.
      // The full logic (OAuth tokens, API key, provider type, base URL)
      // stays at the host level where auth.ts and providers.ts are available.
      checkRemoteSettingsEligibility: () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { CLAUDE_AI_INFERENCE_SCOPE } = require('../constants/oauth.js') as typeof import('../constants/oauth.js')
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getAnthropicApiKeyWithSource, getClaudeAIOAuthTokens } = require('../utils/auth.js') as typeof import('../utils/auth.js')
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getAPIProvider, isFirstPartyAnthropicBaseUrl } = require('../utils/model/providers.js') as typeof import('../utils/model/providers.js')

          if (getAPIProvider() !== 'firstParty') return false
          if (!isFirstPartyAnthropicBaseUrl()) return false
          if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent') return false

          const tokens = getClaudeAIOAuthTokens()
          if (tokens?.accessToken && tokens.subscriptionType === null) return true
          if (
            tokens?.accessToken &&
            tokens.scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE) &&
            (tokens.subscriptionType === 'enterprise' || tokens.subscriptionType === 'team')
          ) return true

          try {
            const { key: apiKey } = getAnthropicApiKeyWithSource({
              skipRetrievingKeyFromApiKeyHelper: true,
            })
            if (apiKey) return true
          } catch { /* no API key available */ }

          return false
        } catch {
          return false
        }
      },
      // V7 §11.4 — permission rule parsing for config validation
      parsePermissionRule: (rule: string) => {
        try {
          const { permissionRuleValueFromString } = require('@claude-code/permission/permissionRuleParser') as typeof import('@claude-code/permission/permissionRuleParser')
          return permissionRuleValueFromString(rule)
        } catch {
          return { toolName: rule }
        }
      },
      // V7 §11.4 — settings path check
      isClaudeSettingsPath: (filePath: string) => {
        try {
          const { isClaudeSettingsPath } = require('@claude-code/permission/filesystem') as typeof import('@claude-code/permission/filesystem')
          return isClaudeSettingsPath(filePath)
        } catch {
          return false
        }
      },
      // V7 §11.4 — permission context reconciliation after settings change
      reconcilePermissionContext: (prevContext: unknown, updatedRules: unknown[]) => {
        try {
          const {
            syncPermissionRulesFromDisk,
            findOverlyBroadBashPermissions,
            removeDangerousPermissions,
            isBypassPermissionsModeDisabled,
            createDisabledBypassPermissionsContext,
            transitionPlanAutoMode,
          } = require('@claude-code/permission/permissionSetup') as typeof import('@claude-code/permission/permissionSetup')
          let ctx = syncPermissionRulesFromDisk(prevContext, updatedRules)
          if (process.env.USER_TYPE === 'ant' && process.env.CLAUDE_CODE_ENTRYPOINT !== 'local-agent') {
            const overlyBroad = findOverlyBroadBashPermissions(updatedRules as any[], [])
            if (overlyBroad.length > 0) {
              ctx = removeDangerousPermissions(ctx, overlyBroad)
            }
          }
          if ((ctx as any).isBypassPermissionsModeAvailable && isBypassPermissionsModeDisabled()) {
            ctx = createDisabledBypassPermissionsContext(ctx)
          }
          ctx = transitionPlanAutoMode(ctx)
          return ctx
        } catch {
          return prevContext
        }
      },
      // V7 §11.4 — memory auto-entry path
      getAutoMemEntrypoint: () => {
        try {
          const { getAutoMemEntrypoint } = require('@claude-code/memory/paths') as typeof import('@claude-code/memory/paths')
          return getAutoMemEntrypoint()
        } catch {
          return ''
        }
      },
    },
    {
      installProviderBindings:
        installers.installProviderBindings ??
        (() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../runtime/installProviderBindings.js')
        }),
      installToolRegistryBindings:
        installers.installToolRegistryBindings ??
        (() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../runtime/installToolRegistryBindings.js')
        }),
      installCommandRuntimeBindings:
        installers.installCommandRuntimeBindings ??
        (() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../runtime/installCommandRuntimeBindings.js')
        }),
      installMcpRuntimeBindings:
        installers.installMcpRuntimeBindings ??
        (() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../runtime/installMcpRuntimeBindings.js')
        }),
    },
  )
}
