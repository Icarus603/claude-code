import * as React from 'react'
import { clearTrustedDeviceTokenCache } from '@claude-code/bridge/trustedDevice.js'
import { Text } from '@anthropic/ink'
import { refreshGrowthBookAfterAuthChange } from '@claude-code/config/feature-flags'
import {
  getGroveNoticeConfig,
  getGroveSettings,
} from '@claude-code/provider/grove.js'
import { clearPolicyLimitsCache } from '@claude-code/provider/policyLimits/index.js'
// flushTelemetry is loaded lazily to avoid pulling in ~1.1MB of OpenTelemetry at startup
import { clearRemoteManagedSettingsCache } from '@claude-code/config/remote'
import { getClaudeAIOAuthTokens, removeApiKey } from '@claude-code/provider/authAlias.js'
import { clearBetasCaches } from '@claude-code/provider/betas.js'
import { saveGlobalConfig } from '@claude-code/config'
import { gracefulShutdownSync } from '@claude-code/app-host/bootstrap/gracefulShutdown.js'
import { getSecureStorage } from '@claude-code/storage/secureStorage.js'
import { clearToolSchemaCache } from '@claude-code/tool-registry/toolSchemaCache.js'
import { resetUserCache } from '@claude-code/provider/user.js'

export async function performLogout({
  clearOnboarding = false,
}): Promise<void> {
  // Flush telemetry BEFORE clearing credentials to prevent org data leakage
  const { flushTelemetry } = await import(
    '@claude-code/local-observability/telemetry'
  )
  await flushTelemetry()

  await removeApiKey()

  // Wipe all secure storage data on logout
  const secureStorage = getSecureStorage()
  secureStorage.delete()

  await clearAuthRelatedCaches()
  saveGlobalConfig(current => {
    const updated = { ...current }
    if (clearOnboarding) {
      updated.hasCompletedOnboarding = false
      updated.subscriptionNoticeCount = 0
      updated.hasAvailableSubscription = false
      if (updated.customApiKeyResponses?.approved) {
        updated.customApiKeyResponses = {
          ...updated.customApiKeyResponses,
          approved: [],
        }
      }
    }
    updated.oauthAccount = undefined
    return updated
  })
}

// clearing anything memoized that must be invalidated when user/session/auth changes
export async function clearAuthRelatedCaches(): Promise<void> {
  // Clear the OAuth token cache
  getClaudeAIOAuthTokens.cache?.clear?.()
  clearTrustedDeviceTokenCache()
  clearBetasCaches()
  clearToolSchemaCache()

  // Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
  resetUserCache()
  refreshGrowthBookAfterAuthChange()

  // Clear Grove config cache
  getGroveNoticeConfig.cache?.clear?.()
  getGroveSettings.cache?.clear?.()

  // Clear remotely managed settings cache
  await clearRemoteManagedSettingsCache()

  // Clear policy limits cache
  await clearPolicyLimitsCache()
}

export async function call(
  onDone: import('@claude-code/agent/command.js').LocalJSXCommandOnDone,
): Promise<React.ReactNode> {
  // V7 §11.6 — with connection-based multi-provider auth, "logout" is no
  // longer a single global action. Opening the connection manager lets the
  // user pick exactly which provider(s) to disconnect. The old "nuke
  // everything" path is still available via performLogout() for callers
  // that need it (e.g. the CLI `ccb logout` subcommand, disaster recovery).
  const { Settings } = await import('@claude-code/repl/components/Settings/Settings.js')
  // Redirect to the /config Status tab which will navigate to connections.
  // Simpler: just open /login which already shows the connection manager
  // when connections exist (state: 'select_connection').
  const { ConsoleOAuthFlow } = await import(
    '@claude-code/repl/components/ConsoleOAuthFlow.js'
  )
  return React.createElement(ConsoleOAuthFlow, {
    onDone: () => onDone(''),
    startingMessage: 'Select a provider to disconnect, or add a new one.',
  })
}
