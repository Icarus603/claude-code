import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin billing access predicates. These gate the /cost UI and credit-balance
 * warnings. Get them wrong and:
 *  - hasConsoleBillingAccess wrong → wrong users see "cost = $X" details
 *    (PII leak for non-admins in a team)
 *  - hasClaudeAiBillingAccess wrong → wrong CTAs (Pro user shown enterprise
 *    "ask your admin" message)
 */
describe('billing access predicates (vs ant role-gating)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'billing.ts'),
    'utf-8',
  )

  describe('hasConsoleBillingAccess', () => {
    const fnStart = source.indexOf('export function hasConsoleBillingAccess')
    const fnSlice = source.slice(fnStart, fnStart + 1500)

    test('DISABLE_COST_WARNINGS env shortcuts to false (universal opt-out)', () => {
      expect(fnSlice).toMatch(
        /if\s*\(isEnvTruthy\(readEnv\('DISABLE_COST_WARNINGS'\)\)\)\s*\{?\s*\n?\s*return false/,
      )
    })

    test('Claude.ai subscribers excluded (this is Console-billing-only)', () => {
      expect(fnSlice).toMatch(/if\s*\(isSubscriber\)\s*return false/)
    })

    test('no auth (logged out) → false', () => {
      expect(fnSlice).toMatch(
        /if\s*\(!authSource\.hasToken && !hasApiKey\)\s*\{?\s*\n?\s*return false/,
      )
    })

    test('admin/billing org role OR workspace_admin/workspace_billing → true', () => {
      expect(fnSlice).toMatch(
        /\['admin', 'billing'\]\.includes\(orgRole\)\s*\|\|\s*\n?\s*\['workspace_admin', 'workspace_billing'\]\.includes\(workspaceRole\)/,
      )
    })

    test('missing role data → false (defensive, don\'t leak cost to undefined-role users)', () => {
      // Without explicit role data, the safe default is "no cost access"
      // — otherwise a freshly-stored oauthAccount without roles populated
      // yet would expose cost details to non-admins for the first ~30s.
      expect(fnSlice).toMatch(
        /if\s*\(!orgRole \|\| !workspaceRole\)\s*\{?\s*\n?\s*return false/,
      )
    })
  })

  describe('hasClaudeAiBillingAccess', () => {
    const fnStart = source.indexOf('export function hasClaudeAiBillingAccess')
    const fnSlice = source.slice(fnStart, fnStart + 1500)

    test('mock override (for /mock-limits testing) takes priority over everything', () => {
      expect(fnSlice).toMatch(
        /if\s*\(mockBillingAccessOverride !== null\)\s*\{?\s*\n?\s*return mockBillingAccessOverride/,
      )
    })

    test('non-Claude.ai subscriber → false (precondition: must be subscriber)', () => {
      expect(fnSlice).toMatch(
        /if\s*\(!isClaudeAISubscriber\(\)\)\s*\{?\s*\n?\s*return false/,
      )
    })

    test('consumer plans (max/pro) → ALWAYS true (individual users)', () => {
      // Individuals always have access to their own billing — no role gate.
      expect(fnSlice).toMatch(
        /if\s*\(subscriptionType === 'max' \|\| subscriptionType === 'pro'\)\s*\{?\s*\n?\s*return true/,
      )
    })

    test('team/enterprise → check admin/billing/owner/primary_owner org role', () => {
      // The 4-role set differs from hasConsoleBillingAccess (which uses
      // admin/billing only). Claude.ai adds owner/primary_owner because
      // enterprise has those distinct roles.
      expect(fnSlice).toMatch(
        /\['admin', 'billing', 'owner', 'primary_owner'\]\.includes\(orgRole\)/,
      )
    })

    test('order: mock → subscriber-precondition → consumer-plan → team-role check', () => {
      // The ordering is load-bearing: mock override BEFORE subscriber
      // check so /mock-limits can simulate non-subscriber scenarios.
      const mockIdx = fnSlice.indexOf('mockBillingAccessOverride !== null')
      const subscriberIdx = fnSlice.indexOf('!isClaudeAISubscriber()')
      const consumerIdx = fnSlice.indexOf("subscriptionType === 'max'")
      const roleIdx = fnSlice.indexOf("'admin', 'billing', 'owner'")
      expect(mockIdx).toBeGreaterThan(0)
      expect(subscriberIdx).toBeGreaterThan(mockIdx)
      expect(consumerIdx).toBeGreaterThan(subscriberIdx)
      expect(roleIdx).toBeGreaterThan(consumerIdx)
    })
  })
})
