import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for fetchProfileInfo + refreshOAuthToken's oauthAccount
 * write vs ant su_/Bq_ (1255.js).
 *
 * ant adds four organization fields to the OAuth profile fetch that ccb
 * didn't read before this commit:
 *   - seatTier — enterprise PAYG vs flat-rate seat type
 *   - ccOnboardingFlags — UI gating for Claude Code onboarding state
 *   - claudeCodeTrialEndsAt — trial expiry deadline
 *   - claudeCodeTrialDurationDays — trial length (for "X of Y days" UI)
 *
 * The trial / onboarding fields populate features in ant's UI that ccb
 * doesn't currently surface, but reading them is structurally required:
 *
 *   1. AccountInfo type carries them so they round-trip through global
 *      config without being dropped.
 *   2. haveProfileAlready check now requires ccOnboardingFlags !== undefined
 *      — otherwise routine refreshes would skip the profile fetch for users
 *      whose stored config was written by an older ccb that didn't have the
 *      field, leaving them PERMANENTLY without trial / seat-tier data.
 *   3. Profile-write guard on rawProfile prevents nulling seatTier when the
 *      profile fetch was short-circuited by haveProfileAlready.
 */
describe('fetchProfileInfo + refreshOAuthToken (ant su_/Bq_ parity)', () => {
  const clientSource = readFileSync(
    resolve(__dirname, '..', 'oauth', 'client.ts'),
    'utf-8',
  )
  const configSource = readFileSync(
    resolve(__dirname, '..', '..', '..', 'config', 'global', 'config.ts'),
    'utf-8',
  )

  test('AccountInfo type has seatTier / ccOnboardingFlags / trial fields', () => {
    expect(configSource).toMatch(/seatTier\?:\s*string\s*\|\s*null/)
    expect(configSource).toMatch(/ccOnboardingFlags\?:\s*Record<string,\s*unknown>/)
    expect(configSource).toMatch(/claudeCodeTrialEndsAt\?:\s*string\s*\|\s*null/)
    expect(configSource).toMatch(/claudeCodeTrialDurationDays\?:\s*number\s*\|\s*null/)
  })

  test('fetchProfileInfo reads seat_tier from profile.organization', () => {
    expect(clientSource).toMatch(
      /seatTier:\s*profile\?\.organization\?\.seat_tier\s*\?\?\s*null/,
    )
  })

  test('fetchProfileInfo reads cc_onboarding_flags with empty-object default', () => {
    expect(clientSource).toMatch(
      /ccOnboardingFlags:\s*profile\?\.organization\?\.cc_onboarding_flags\s*\?\?\s*\{\}/,
    )
  })

  test('fetchProfileInfo reads trial fields', () => {
    expect(clientSource).toMatch(
      /claudeCodeTrialEndsAt:\s*\n?\s*profile\?\.organization\?\.claude_code_trial_ends_at\s*\?\?\s*null/,
    )
    expect(clientSource).toMatch(
      /claudeCodeTrialDurationDays:\s*\n?\s*profile\?\.organization\?\.claude_code_trial_duration_days\s*\?\?\s*null/,
    )
  })

  test('haveProfileAlready requires ccOnboardingFlags !== undefined (else upgrade users lose data)', () => {
    // Pre-fix ccb checked only billingType/accountCreatedAt/subscriptionCreatedAt.
    // If a user upgraded ccb without their config containing ccOnboardingFlags,
    // every refresh would have all three "old" fields satisfied and skip the
    // profile fetch — they'd never gain the new fields.
    expect(clientSource).toMatch(
      /haveProfileAlready =[\s\S]*?config\.oauthAccount\?\.ccOnboardingFlags\s*!==\s*undefined/,
    )
  })

  test('oauthAccount write only stamps trial/seat fields when rawProfile is present', () => {
    // Without this guard, the haveProfileAlready short-circuit (which returns
    // profileInfo=null) would clobber stored seatTier with null on every
    // routine refresh that succeeded against the OAuth backend.
    expect(clientSource).toMatch(
      /if\s*\(profileInfo\.rawProfile\)\s*\{[\s\S]*?updates\.seatTier\s*=\s*profileInfo\.seatTier/,
    )
    expect(clientSource).toMatch(
      /updates\.ccOnboardingFlags\s*=\s*profileInfo\.ccOnboardingFlags/,
    )
    expect(clientSource).toMatch(
      /updates\.claudeCodeTrialEndsAt\s*=\s*profileInfo\.claudeCodeTrialEndsAt/,
    )
    expect(clientSource).toMatch(
      /updates\.claudeCodeTrialDurationDays\s*=\s*\n?\s*profileInfo\.claudeCodeTrialDurationDays/,
    )
  })
})
