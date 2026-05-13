import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin installOAuthTokens (cli/handlers/auth.ts) — the function that
 * persists OAuth tokens + account info after a successful /login.
 *
 * CRITICAL gap fixed: installOAuthTokens MUST pass the same 4 new fields
 * (seatTier, ccOnboardingFlags, trial ends, trial days) that
 * populateOAuthAccountInfoIfNeeded already does. Without this, /login
 * users get stored without those fields, then the next routine refresh's
 * haveProfileAlready guard (now requiring ccOnboardingFlags !== undefined)
 * skips re-fetch — cumulative miss for the entire session.
 */
describe('installOAuthTokens stores ALL 4 new ant fields (ant ng6/ZIH parity)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'handlers', 'auth.ts'),
    'utf-8',
  )

  const fnStart = source.indexOf('export async function installOAuthTokens')
  const fnSlice = source.slice(fnStart, fnStart + 3000)

  test('passes ccOnboardingFlags to storeOAuthAccountInfo (with empty-object default)', () => {
    expect(fnSlice).toMatch(
      /ccOnboardingFlags:\s*profile\.organization\?\.cc_onboarding_flags\s*\?\?\s*\{\}/,
    )
  })

  test('passes claudeCodeTrialEndsAt to storeOAuthAccountInfo (with null default)', () => {
    expect(fnSlice).toMatch(
      /claudeCodeTrialEndsAt:[\s\S]{0,80}profile\.organization\?\.claude_code_trial_ends_at\s*\?\?\s*null/,
    )
  })

  test('passes claudeCodeTrialDurationDays to storeOAuthAccountInfo (with null default)', () => {
    expect(fnSlice).toMatch(
      /claudeCodeTrialDurationDays:[\s\S]{0,80}profile\.organization\?\.claude_code_trial_duration_days\s*\?\?\s*null/,
    )
  })

  test('passes seatTier to storeOAuthAccountInfo (with null default)', () => {
    expect(fnSlice).toMatch(
      /seatTier:\s*profile\.organization\?\.seat_tier\s*\?\?\s*null/,
    )
  })

  test('post-login orchestration: storeOAuthAccountInfo → saveOAuthTokensIfNeeded → clearOAuthTokenCache', () => {
    // Order matters: account info gets stored first, then tokens, then
    // cache is cleared so the next read sees fresh state.
    const storeIdx = fnSlice.indexOf('storeOAuthAccountInfo')
    const saveIdx = fnSlice.indexOf('saveOAuthTokensIfNeeded(tokens)')
    const clearIdx = fnSlice.indexOf('clearOAuthTokenCache()')
    expect(storeIdx).toBeGreaterThan(0)
    expect(saveIdx).toBeGreaterThan(storeIdx)
    expect(clearIdx).toBeGreaterThan(saveIdx)
  })

  test('fetchAndStoreUserRoles called but failures NOT fatal (limited-scope tokens)', () => {
    // Setup-token tokens (inference-only) lack user:profile scope, so the
    // roles endpoint 403s. Don't let that fail the whole /login.
    expect(fnSlice).toMatch(
      /fetchAndStoreUserRoles\(tokens\.accessToken\)\.catch\([\s\S]{0,150}logForDebugging/,
    )
  })

  test('Claude.ai subscriber path: fetchAndStoreClaudeCodeFirstTokenDate (non-fatal)', () => {
    expect(fnSlice).toMatch(
      /if\s*\(shouldUseClaudeAIAuth\(tokens\.scopes\)\)[\s\S]*?fetchAndStoreClaudeCodeFirstTokenDate\(\)\.catch/,
    )
  })

  test('Console path: createAndStoreApiKey is FATAL on failure (else how would Console user proceed?)', () => {
    // Critical to NOT swallow this — Console users sign in TO get an API
    // key. If the key creation fails, there's no recovery; the user must
    // try /login again.
    expect(fnSlice).toMatch(
      /const apiKey = await createAndStoreApiKey\(tokens\.accessToken\)[\s\S]*?if\s*\(!apiKey\)\s*\{[\s\S]*?throw new Error/,
    )
  })
})
