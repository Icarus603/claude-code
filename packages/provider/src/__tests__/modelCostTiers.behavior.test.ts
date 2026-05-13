import { describe, expect, test } from 'bun:test'

import {
  COST_HAIKU_35,
  COST_HAIKU_45,
  COST_TIER_3_15,
  COST_TIER_5_25,
  COST_TIER_15_75,
  COST_TIER_30_150,
} from '../modelCost.ts'

/**
 * Pin the pricing-tier constants exactly. These are USD-per-Mtok rates
 * straight from https://platform.claude.com/docs/en/about-claude/pricing.
 *
 * A wrong value here causes:
 * - Cost-tracking display ("$X.XX this session") to lie to the user
 * - /cost command to be off
 * - SDK consumers that read usage cost to bill wrong
 *
 * Each tier is paired with the models that consume it (in MODEL_COSTS map).
 * If Anthropic ever changes pricing, the change must be reflected here AND
 * the tests must be updated together — pin makes the dual-write explicit.
 */
describe('Model pricing tier constants (vs ant pricing tables)', () => {
  test('COST_TIER_3_15: Sonnet 3.5/3.7/4.0/4.5/4.6 — $3 in / $15 out per Mtok', () => {
    expect(COST_TIER_3_15.inputTokens).toBe(3)
    expect(COST_TIER_3_15.outputTokens).toBe(15)
    // Cache write = 1.25× input (standard Anthropic multiplier)
    expect(COST_TIER_3_15.promptCacheWriteTokens).toBe(3.75)
    // Cache read = 0.1× input
    expect(COST_TIER_3_15.promptCacheReadTokens).toBe(0.3)
    // Web search: $10 per 1000 = $0.01 per request
    expect(COST_TIER_3_15.webSearchRequests).toBe(0.01)
  })

  test('COST_TIER_15_75: Opus 4.0/4.1 — $15 in / $75 out per Mtok', () => {
    expect(COST_TIER_15_75.inputTokens).toBe(15)
    expect(COST_TIER_15_75.outputTokens).toBe(75)
    expect(COST_TIER_15_75.promptCacheWriteTokens).toBe(18.75) // 1.25× input
    expect(COST_TIER_15_75.promptCacheReadTokens).toBe(1.5) // 0.1× input
  })

  test('COST_TIER_5_25: Opus 4.5/4.6/4.7 — $5 in / $25 out per Mtok (PRICE CUT vs 4.0)', () => {
    expect(COST_TIER_5_25.inputTokens).toBe(5)
    expect(COST_TIER_5_25.outputTokens).toBe(25)
    expect(COST_TIER_5_25.promptCacheWriteTokens).toBe(6.25)
    expect(COST_TIER_5_25.promptCacheReadTokens).toBe(0.5)
  })

  test('COST_TIER_30_150: Opus 4.6 FAST MODE — $30 in / $150 out (10× tier-3_15)', () => {
    expect(COST_TIER_30_150.inputTokens).toBe(30)
    expect(COST_TIER_30_150.outputTokens).toBe(150)
    expect(COST_TIER_30_150.promptCacheWriteTokens).toBe(37.5)
    expect(COST_TIER_30_150.promptCacheReadTokens).toBe(3)
  })

  test('COST_HAIKU_35: Haiku 3.5 — $0.80 in / $4 out per Mtok', () => {
    expect(COST_HAIKU_35.inputTokens).toBe(0.8)
    expect(COST_HAIKU_35.outputTokens).toBe(4)
    expect(COST_HAIKU_35.promptCacheWriteTokens).toBe(1)
    expect(COST_HAIKU_35.promptCacheReadTokens).toBe(0.08)
  })

  test('COST_HAIKU_45: Haiku 4.5 — $1 in / $5 out per Mtok (price tick-up vs 3.5)', () => {
    expect(COST_HAIKU_45.inputTokens).toBe(1)
    expect(COST_HAIKU_45.outputTokens).toBe(5)
    expect(COST_HAIKU_45.promptCacheWriteTokens).toBe(1.25)
    expect(COST_HAIKU_45.promptCacheReadTokens).toBe(0.1)
  })

  test('all tiers use the same webSearchRequests rate ($0.01 = $10/1000)', () => {
    expect(COST_TIER_3_15.webSearchRequests).toBe(0.01)
    expect(COST_TIER_15_75.webSearchRequests).toBe(0.01)
    expect(COST_TIER_5_25.webSearchRequests).toBe(0.01)
    expect(COST_TIER_30_150.webSearchRequests).toBe(0.01)
    expect(COST_HAIKU_35.webSearchRequests).toBe(0.01)
    expect(COST_HAIKU_45.webSearchRequests).toBe(0.01)
  })

  test('output is 5× input for all Anthropic tiers (Sonnet/Opus ratio invariant)', () => {
    expect(COST_TIER_3_15.outputTokens / COST_TIER_3_15.inputTokens).toBe(5)
    expect(COST_TIER_15_75.outputTokens / COST_TIER_15_75.inputTokens).toBe(5)
    expect(COST_TIER_5_25.outputTokens / COST_TIER_5_25.inputTokens).toBe(5)
    expect(COST_HAIKU_35.outputTokens / COST_HAIKU_35.inputTokens).toBe(5)
    expect(COST_HAIKU_45.outputTokens / COST_HAIKU_45.inputTokens).toBe(5)
  })

  test('cache write is 1.25× input for all tiers (Anthropic standard multiplier)', () => {
    expect(COST_TIER_3_15.promptCacheWriteTokens / COST_TIER_3_15.inputTokens).toBeCloseTo(1.25)
    expect(COST_TIER_15_75.promptCacheWriteTokens / COST_TIER_15_75.inputTokens).toBeCloseTo(1.25)
    expect(COST_TIER_5_25.promptCacheWriteTokens / COST_TIER_5_25.inputTokens).toBeCloseTo(1.25)
    expect(COST_HAIKU_45.promptCacheWriteTokens / COST_HAIKU_45.inputTokens).toBeCloseTo(1.25)
  })

  test('cache read is 0.1× input for all tiers', () => {
    expect(COST_TIER_3_15.promptCacheReadTokens / COST_TIER_3_15.inputTokens).toBeCloseTo(0.1)
    expect(COST_TIER_15_75.promptCacheReadTokens / COST_TIER_15_75.inputTokens).toBeCloseTo(0.1)
    expect(COST_TIER_5_25.promptCacheReadTokens / COST_TIER_5_25.inputTokens).toBeCloseTo(0.1)
    expect(COST_HAIKU_45.promptCacheReadTokens / COST_HAIKU_45.inputTokens).toBeCloseTo(0.1)
  })
})
