import * as React from 'react'
import { clearTrustedDeviceTokenCache } from '@claude-code/bridge/trustedDevice.js'
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
  // V7 §11.6 — with connection-based multi-provider auth, "logout" is a
  // per-connection disconnect, not a global nuke. The picker shortcuts
  // to direct disconnect when there is exactly one connection, otherwise
  // it shows a disconnect-only list (no "+ Add new" entry — that's what
  // /login is for). The "nuke everything" path is still available via
  // performLogout() for the `ccb logout` CLI subcommand and disaster
  // recovery.
  const { LogoutPicker } = await import(
    '@claude-code/repl/components/LogoutPicker.js'
  )
  return React.createElement(LogoutPicker, {
    onDone: (message: string) => onDone(message),
  })
}
