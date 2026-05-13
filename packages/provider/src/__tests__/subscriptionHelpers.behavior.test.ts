import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pins for the cluster of subscription/rate-limit helpers vs ant
 * (1997.js): No, QQ_, rr, SX1, qOH, gQ_, nIH, n6H, EX1, D2H, wA9.
 *
 * These helpers are leaf functions — the real risk is wrong return types or
 * missing subscription cases. Pin the exact strings/types so /status,
 * /context, and rate-limit message gating stay accurate.
 */
describe('subscription helpers (ant No/QQ_/etc parity)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  test('getRateLimitTier: gates on isAnthropicAuthEnabled then ?? null', () => {
    const fnStart = authAliasSource.indexOf('export function getRateLimitTier')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 400)
    expect(fnSlice).toMatch(/if\s*\(!isAnthropicAuthEnabled\(\)\)/)
    expect(fnSlice).toMatch(/return oauthTokens\.rateLimitTier\s*\?\?\s*null/)
  })

  test('getSubscriptionName: full switch covers enterprise/team/max/pro + Claude API default', () => {
    const fnStart = authAliasSource.indexOf('export function getSubscriptionName')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 600)
    // Exact strings — these literals are shown to the user in /status
    expect(fnSlice).toMatch(/case 'enterprise':\s*\n?\s*return 'Claude Enterprise'/)
    expect(fnSlice).toMatch(/case 'team':\s*\n?\s*return 'Claude Team'/)
    expect(fnSlice).toMatch(/case 'max':\s*\n?\s*return 'Claude Max'/)
    expect(fnSlice).toMatch(/case 'pro':\s*\n?\s*return 'Claude Pro'/)
    expect(fnSlice).toMatch(/default:\s*\n?\s*return 'Claude API'/)
  })

  test('isMaxSubscriber: strict === comparison against subscriptionType', () => {
    expect(authAliasSource).toMatch(
      /export function isMaxSubscriber\(\)[\s\S]{0,150}?getSubscriptionType\(\)\s*===\s*'max'/,
    )
  })

  test('hasOpusAccess: includes ALL paid tiers + null sentinel (in-doubt grants access)', () => {
    const fnStart = authAliasSource.indexOf('export function hasOpusAccess')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 700)
    // Note ant EX1 explicitly includes `null` — "when in doubt, don't limit access"
    expect(fnSlice).toMatch(/subscriptionType === 'max'/)
    expect(fnSlice).toMatch(/subscriptionType === 'enterprise'/)
    expect(fnSlice).toMatch(/subscriptionType === 'team'/)
    expect(fnSlice).toMatch(/subscriptionType === 'pro'/)
    expect(fnSlice).toMatch(/subscriptionType === null/)
  })

  test('isOverageProvisioningAllowed: requires Claude.ai subscriber + valid billingType', () => {
    const fnStart = authAliasSource.indexOf('export function isOverageProvisioningAllowed')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 800)
    // ant tOH: !Eq()||!billingType → false; then enum check
    expect(fnSlice).toMatch(/billingType/)
    expect(fnSlice).toMatch(/stripe_subscription/)
    expect(fnSlice).toMatch(/apple_subscription/)
    expect(fnSlice).toMatch(/google_play_subscription/)
  })

  test('isConsumerSubscriber: Claude.ai + max/pro only (no team/enterprise)', () => {
    const fnStart = authAliasSource.indexOf('export function isConsumerSubscriber')
    const fnSlice = authAliasSource.slice(fnStart, fnStart + 500)
    expect(fnSlice).toMatch(/isClaudeAISubscriber\(\)/)
    expect(fnSlice).toMatch(/isConsumerPlan\(subscriptionType\)/)
    // The helper itself encodes ant IX1: max || pro
    expect(authAliasSource).toMatch(
      /function isConsumerPlan\([\s\S]*?return plan === 'max' \|\| plan === 'pro'/,
    )
  })
})
