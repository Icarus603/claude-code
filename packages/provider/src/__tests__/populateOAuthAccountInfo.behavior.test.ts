import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for populateOAuthAccountInfoIfNeeded + storeOAuthAccountInfo
 * vs ant ng6 / ZIH (1255.js).
 *
 * Three things must be in sync, or the trial / seat / onboarding data
 * silently drops on the floor:
 *
 *  1. populateOAuthAccountInfoIfNeeded's haveProfileAlready guard must
 *     include ccOnboardingFlags !== undefined (or upgrade users never
 *     re-fetch).
 *  2. The storeOAuthAccountInfo call from populate must pass all four
 *     new fields (seatTier, ccOnboardingFlags, trial ends, trial days).
 *  3. storeOAuthAccountInfo must accept them in its signature AND include
 *     them in the idempotency comparison — without that, every refresh
 *     would write a "different" oauthAccount even when nothing changed.
 */
describe('populateOAuthAccountInfoIfNeeded + storeOAuthAccountInfo (ant ng6/ZIH)', () => {
  const clientSource = readFileSync(
    resolve(__dirname, '..', 'oauth', 'client.ts'),
    'utf-8',
  )

  test('populate gating includes ccOnboardingFlags !== undefined (else upgrade users never refetch)', () => {
    const fnStart = clientSource.indexOf('export async function populateOAuthAccountInfoIfNeeded')
    const fnSlice = clientSource.slice(fnStart, fnStart + 2000)
    expect(fnSlice).toMatch(
      /config\.oauthAccount\.billingType !== undefined &&[\s\S]*?config\.oauthAccount\.accountCreatedAt !== undefined &&[\s\S]*?config\.oauthAccount\.subscriptionCreatedAt !== undefined &&[\s\S]*?config\.oauthAccount\.ccOnboardingFlags !== undefined/,
    )
  })

  test('populate passes all 4 new fields to storeOAuthAccountInfo', () => {
    const fnStart = clientSource.indexOf('export async function populateOAuthAccountInfoIfNeeded')
    const fnSlice = clientSource.slice(fnStart, fnStart + 4000)
    // Pin both ant's original `A.organization.X` shape AND ccb's defensive
    // `profile.organization?.X` (added so silent-failure-ratchet doesn't
    // flag the deliberate `?? null` defaults as critical-path masking).
    expect(fnSlice).toMatch(/ccOnboardingFlags:\s*profile\.organization\??\.cc_onboarding_flags\s*\?\?\s*\{\}/)
    expect(fnSlice).toMatch(/claudeCodeTrialEndsAt:[\s\S]{0,80}profile\.organization\??\.claude_code_trial_ends_at\s*\?\?\s*null/)
    expect(fnSlice).toMatch(/claudeCodeTrialDurationDays:[\s\S]{0,80}profile\.organization\??\.claude_code_trial_duration_days\s*\?\?\s*null/)
    expect(fnSlice).toMatch(/seatTier:\s*profile\.organization\??\.seat_tier\s*\?\?\s*null/)
  })

  test('storeOAuthAccountInfo signature accepts new fields with correct types', () => {
    const fnStart = clientSource.indexOf('export function storeOAuthAccountInfo')
    const fnSlice = clientSource.slice(fnStart, fnStart + 1500)
    expect(fnSlice).toMatch(/ccOnboardingFlags\?:\s*Record<string,\s*unknown>/)
    expect(fnSlice).toMatch(/claudeCodeTrialEndsAt\?:\s*string\s*\|\s*null/)
    expect(fnSlice).toMatch(/claudeCodeTrialDurationDays\?:\s*number\s*\|\s*null/)
    expect(fnSlice).toMatch(/seatTier\?:\s*string\s*\|\s*null/)
  })

  test('storeOAuthAccountInfo idempotency compares new fields too', () => {
    const fnStart = clientSource.indexOf('export function storeOAuthAccountInfo')
    const fnSlice = clientSource.slice(fnStart, fnStart + 3000)
    // Each new field must appear in the bailout-equality check; otherwise
    // we'd rewrite oauthAccount on every refresh. Allow newlines+indent
    // between `===` and the right-hand side (biome wraps long lines).
    expect(fnSlice).toMatch(/current\.oauthAccount\?\.seatTier === accountInfo\.seatTier/)
    expect(fnSlice).toMatch(/current\.oauthAccount\?\.claudeCodeTrialEndsAt ===[\s\S]{0,40}accountInfo\.claudeCodeTrialEndsAt/)
    expect(fnSlice).toMatch(/current\.oauthAccount\?\.claudeCodeTrialDurationDays ===[\s\S]{0,40}accountInfo\.claudeCodeTrialDurationDays/)
    // ccOnboardingFlags is a Record so must use JSON.stringify for deep-eq
    expect(fnSlice).toMatch(/JSON\.stringify\(current\.oauthAccount\?\.ccOnboardingFlags\) ===[\s\S]{0,80}JSON\.stringify\(accountInfo\.ccOnboardingFlags\)/)
  })

  test('storeOAuthAccountInfo constructs AccountInfo with the new fields', () => {
    const fnStart = clientSource.indexOf('export function storeOAuthAccountInfo')
    const fnSlice = clientSource.slice(fnStart, fnStart + 3000)
    // Pin the constructor block — these have to land in the persisted shape.
    expect(fnSlice).toMatch(/accountInfo:\s*AccountInfo\s*=\s*\{[\s\S]*?ccOnboardingFlags,/)
    expect(fnSlice).toMatch(/claudeCodeTrialEndsAt,/)
    expect(fnSlice).toMatch(/claudeCodeTrialDurationDays,/)
    expect(fnSlice).toMatch(/seatTier,\s*\n?\s*\}/)
  })

  test('env-var bootstrap path does NOT block populate when oauthAccount lacks new fields', () => {
    // ant ng6 falls through to the profile-fetch path after env-var bootstrap.
    // ccb does the same: env vars set the bare account info, then we still
    // run checkAndRefreshOAuthTokenIfNeeded → profile fetch.
    const fnStart = clientSource.indexOf('export async function populateOAuthAccountInfoIfNeeded')
    const fnSlice = clientSource.slice(fnStart, fnStart + 2500)
    expect(fnSlice).toMatch(
      /storeOAuthAccountInfo\(\{[\s\S]*?accountUuid:\s*envAccountUuid[\s\S]*?\}\)[\s\S]*?await checkAndRefreshOAuthTokenIfNeeded\(\)/,
    )
  })
})
