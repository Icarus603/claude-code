import { describe, expect, test } from 'bun:test'
import {
  COST_HAIKU_35,
  COST_HAIKU_45,
  COST_TIER_3_15,
  COST_TIER_5_25,
  COST_TIER_15_75,
  COST_TIER_30_150,
  formatModelPricing,
} from '../modelCost.js'

describe('cost tier constants — anchor to documented pricing', () => {
  // These must match https://platform.claude.com/docs/en/about-claude/pricing.
  // The cache-write/read ratios are derived from input price (×1.25 / ×0.1)
  // per Anthropic's pricing model. If a tier changes upstream, the value
  // in this test must also change — we don't want a silent drift.

  test('COST_TIER_3_15 — Sonnet pricing', () => {
    expect(COST_TIER_3_15).toEqual({
      inputTokens: 3,
      outputTokens: 15,
      promptCacheWriteTokens: 3.75,
      promptCacheReadTokens: 0.3,
      webSearchRequests: 0.01,
    })
  })

  test('COST_TIER_15_75 — Opus 4 / 4.1 pricing', () => {
    expect(COST_TIER_15_75).toEqual({
      inputTokens: 15,
      outputTokens: 75,
      promptCacheWriteTokens: 18.75,
      promptCacheReadTokens: 1.5,
      webSearchRequests: 0.01,
    })
  })

  test('COST_TIER_5_25 — Opus 4.5/4.6/4.7 base pricing', () => {
    expect(COST_TIER_5_25).toEqual({
      inputTokens: 5,
      outputTokens: 25,
      promptCacheWriteTokens: 6.25,
      promptCacheReadTokens: 0.5,
      webSearchRequests: 0.01,
    })
  })

  test('COST_TIER_30_150 — Opus fast mode (6× base)', () => {
    expect(COST_TIER_30_150).toEqual({
      inputTokens: 30,
      outputTokens: 150,
      promptCacheWriteTokens: 37.5,
      promptCacheReadTokens: 3,
      webSearchRequests: 0.01,
    })
    // Fast mode = 6× the base Opus 4.6 input price.
    expect(COST_TIER_30_150.inputTokens).toBe(COST_TIER_5_25.inputTokens * 6)
    expect(COST_TIER_30_150.outputTokens).toBe(COST_TIER_5_25.outputTokens * 6)
  })

  test('COST_HAIKU_35 — Haiku 3.5 pricing', () => {
    expect(COST_HAIKU_35).toEqual({
      inputTokens: 0.8,
      outputTokens: 4,
      promptCacheWriteTokens: 1,
      promptCacheReadTokens: 0.08,
      webSearchRequests: 0.01,
    })
  })

  test('COST_HAIKU_45 — Haiku 4.5 pricing (slightly above 3.5)', () => {
    expect(COST_HAIKU_45).toEqual({
      inputTokens: 1,
      outputTokens: 5,
      promptCacheWriteTokens: 1.25,
      promptCacheReadTokens: 0.1,
      webSearchRequests: 0.01,
    })
  })

  test('cache write is always 1.25× input price', () => {
    // The 25% premium on cache write is documented Anthropic pricing.
    // Locking it here means any tier that breaks the ratio is flagged.
    const tiers = [
      COST_TIER_3_15,
      COST_TIER_15_75,
      COST_TIER_5_25,
      COST_TIER_30_150,
      COST_HAIKU_35,
      COST_HAIKU_45,
    ]
    for (const t of tiers) {
      // Round to 4 decimals to avoid float-precision noise (1 × 1.25 = 1.25
      // exactly; 0.8 × 1.25 = 1.0 exactly; etc.).
      expect(Number((t.inputTokens * 1.25).toFixed(4))).toBe(
        Number(t.promptCacheWriteTokens.toFixed(4)),
      )
    }
  })

  test('cache read is always 0.1× input price', () => {
    const tiers = [
      COST_TIER_3_15,
      COST_TIER_15_75,
      COST_TIER_5_25,
      COST_TIER_30_150,
      COST_HAIKU_35,
      COST_HAIKU_45,
    ]
    for (const t of tiers) {
      // Float-precision noise: 0.8 × 0.1 = 0.08000000000000002.
      expect(Number((t.inputTokens * 0.1).toFixed(4))).toBe(
        Number(t.promptCacheReadTokens.toFixed(4)),
      )
    }
  })

  test('output is always 5× input price (consistent across all tiers)', () => {
    // The 5× output multiplier is Anthropic's standard ratio.
    const tiers = [
      COST_TIER_3_15,
      COST_TIER_15_75,
      COST_TIER_5_25,
      COST_TIER_30_150,
      COST_HAIKU_35,
      COST_HAIKU_45,
    ]
    for (const t of tiers) {
      expect(t.outputTokens).toBe(t.inputTokens * 5)
    }
  })

  test('webSearchRequests is uniformly $0.01 (10c per 1000)', () => {
    const tiers = [
      COST_TIER_3_15,
      COST_TIER_15_75,
      COST_TIER_5_25,
      COST_TIER_30_150,
      COST_HAIKU_35,
      COST_HAIKU_45,
    ]
    for (const t of tiers) {
      expect(t.webSearchRequests).toBe(0.01)
    }
  })
})

describe('formatModelPricing', () => {
  test('integer prices → "$3/$15 per Mtok"', () => {
    expect(formatModelPricing(COST_TIER_3_15)).toBe('$3/$15 per Mtok')
  })

  test('Opus tier → "$15/$75 per Mtok"', () => {
    expect(formatModelPricing(COST_TIER_15_75)).toBe('$15/$75 per Mtok')
  })

  test('Opus 4.6 → "$5/$25 per Mtok"', () => {
    expect(formatModelPricing(COST_TIER_5_25)).toBe('$5/$25 per Mtok')
  })

  test('Opus fast mode → "$30/$150 per Mtok"', () => {
    expect(formatModelPricing(COST_TIER_30_150)).toBe('$30/$150 per Mtok')
  })

  test('Haiku 4.5 → "$1/$5 per Mtok" (integer-formatted)', () => {
    expect(formatModelPricing(COST_HAIKU_45)).toBe('$1/$5 per Mtok')
  })

  test('Haiku 3.5 → "$0.80/$4 per Mtok" (decimal input, integer output)', () => {
    // Critical: 0.8 IS Number.isInteger-false → formatted as $0.80.
    // 4 IS integer → formatted as $4. The asymmetric formatting is the
    // contract that anchors documentation alignment.
    expect(formatModelPricing(COST_HAIKU_35)).toBe('$0.80/$4 per Mtok')
  })

  test('non-integer with multiple decimals → 2-decimal precision', () => {
    // Synthetic: 22.5 → "$22.50". Document the toFixed(2) behavior.
    expect(
      formatModelPricing({
        inputTokens: 22.5,
        outputTokens: 100,
        promptCacheWriteTokens: 28.125,
        promptCacheReadTokens: 2.25,
        webSearchRequests: 0.01,
      }),
    ).toBe('$22.50/$100 per Mtok')
  })

  test('zero pricing edge → "$0/$0 per Mtok"', () => {
    expect(
      formatModelPricing({
        inputTokens: 0,
        outputTokens: 0,
        promptCacheWriteTokens: 0,
        promptCacheReadTokens: 0,
        webSearchRequests: 0,
      }),
    ).toBe('$0/$0 per Mtok')
  })

  test('formatPrice — sub-dollar amounts get $0.XX form', () => {
    // 0.99 is not integer → "$0.99/$1 per Mtok". Sanity check the
    // formatter handles cases under $1.
    expect(
      formatModelPricing({
        inputTokens: 0.99,
        outputTokens: 1,
        promptCacheWriteTokens: 1.2375,
        promptCacheReadTokens: 0.099,
        webSearchRequests: 0.01,
      }),
    ).toBe('$0.99/$1 per Mtok')
  })
})
