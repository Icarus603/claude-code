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
      logDebug: (message, metadata) => logForDebugging(message, metadata as any),
      now: () => Date.now(),
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
