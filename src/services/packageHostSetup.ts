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
        addPermissionRulesToSettings: (...a: unknown[]) => {
          try { return require('../utils/permissions/permissionsLoader.js').addPermissionRulesToSettings(...a) } catch { return false }
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
        try { require('../services/eventLogger.js').logEvent(event, metadata) } catch { /* best-effort */ }
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
          const { logEvent } = require('../services/eventLogger.js') as typeof import('../services/eventLogger.js')
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
