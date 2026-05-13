import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin performLogout + clearAuthRelatedCaches.
 *
 * Logout has strong ordering invariants because credentials change ↔
 * caches must invalidate. Get the order wrong and you can leak:
 *  - Wrong telemetry → org data flushed to wrong account context
 *  - Wrong API key → next CLI run keeps using removed credentials
 *  - Wrong GrowthBook refresh → feature flags read on stale user identity
 */
describe('performLogout + clearAuthRelatedCaches order invariants', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'commands', 'logout', 'logout.tsx'),
    'utf-8',
  )

  describe('performLogout (top-level orchestration)', () => {
    const fnStart = source.indexOf('export async function performLogout')
    const fnSlice = source.slice(fnStart, fnStart + 2000)

    test('CRITICAL: flushTelemetry BEFORE removeApiKey (prevents org data leak)', () => {
      const flushIdx = fnSlice.indexOf('await flushTelemetry()')
      const removeKeyIdx = fnSlice.indexOf('await removeApiKey()')
      expect(flushIdx).toBeGreaterThan(0)
      expect(removeKeyIdx).toBeGreaterThan(flushIdx)
    })

    test('flushTelemetry imported LAZILY (avoid pulling OpenTelemetry at startup)', () => {
      // ~1.1MB of OTel modules pull in if loaded eagerly. Logout is rare
      // and ALREADY blocking, so lazy import is the right tradeoff.
      expect(fnSlice).toMatch(
        /const \{ flushTelemetry \} = await import\(\s*\n?\s*'@claude-code\/local-observability\/telemetry'/,
      )
    })

    test('secureStorage.delete() wipes all credential blobs', () => {
      expect(fnSlice).toMatch(/secureStorage\.delete\(\)/)
    })

    test('clearAuthRelatedCaches runs BEFORE saveGlobalConfig oauthAccount=undefined', () => {
      const clearIdx = fnSlice.indexOf('await clearAuthRelatedCaches()')
      const saveConfigIdx = fnSlice.indexOf('saveGlobalConfig(current =>')
      expect(clearIdx).toBeGreaterThan(0)
      expect(saveConfigIdx).toBeGreaterThan(clearIdx)
    })

    test('clearOnboarding=true also wipes subscription state + approved api keys', () => {
      // Used by "factory reset" flows. Wipes:
      //  - hasCompletedOnboarding (re-runs onboarding next launch)
      //  - subscriptionNoticeCount (re-shows upsells)
      //  - hasAvailableSubscription (re-checks)
      //  - customApiKeyResponses.approved (forgets approved keys)
      expect(fnSlice).toMatch(/if\s*\(clearOnboarding\)\s*\{[\s\S]*?hasCompletedOnboarding = false/)
      expect(fnSlice).toMatch(/subscriptionNoticeCount = 0/)
      expect(fnSlice).toMatch(/hasAvailableSubscription = false/)
      expect(fnSlice).toMatch(/customApiKeyResponses[\s\S]*?approved:\s*\[\]/)
    })

    test('oauthAccount = undefined is the last step', () => {
      expect(fnSlice).toMatch(/updated\.oauthAccount = undefined[\s\S]*?return updated/)
    })
  })

  describe('clearAuthRelatedCaches (cache invalidation surface)', () => {
    const fnStart = source.indexOf('export async function clearAuthRelatedCaches')
    const fnSlice = source.slice(fnStart, fnStart + 1500)

    test('OAuth token memoize cleared (must come first — others depend on it)', () => {
      expect(fnSlice).toMatch(/getClaudeAIOAuthTokens\.cache\?\.clear\?\.\(\)/)
    })

    test('clears: bridge trusted-device + betas + tool-schema + user + Grove + remote-settings + policy-limits', () => {
      expect(fnSlice).toMatch(/clearTrustedDeviceTokenCache\(\)/)
      expect(fnSlice).toMatch(/clearBetasCaches\(\)/)
      expect(fnSlice).toMatch(/clearToolSchemaCache\(\)/)
      expect(fnSlice).toMatch(/resetUserCache\(\)/)
      expect(fnSlice).toMatch(/getGroveNoticeConfig\.cache\?\.clear\?\.\(\)/)
      expect(fnSlice).toMatch(/getGroveSettings\.cache\?\.clear\?\.\(\)/)
      expect(fnSlice).toMatch(/clearRemoteManagedSettingsCache\(\)/)
      expect(fnSlice).toMatch(/clearPolicyLimitsCache\(\)/)
    })

    test('CRITICAL: resetUserCache BEFORE refreshGrowthBookAfterAuthChange', () => {
      // GrowthBook reads user identity to compute flag assignments.
      // Refreshing GB with stale user identity gives flags for the old
      // account; new account's session would inherit ex-user's experiments.
      const resetUserIdx = fnSlice.indexOf('resetUserCache()')
      const refreshGbIdx = fnSlice.indexOf('refreshGrowthBookAfterAuthChange()')
      expect(resetUserIdx).toBeGreaterThan(0)
      expect(refreshGbIdx).toBeGreaterThan(resetUserIdx)
    })
  })
})
