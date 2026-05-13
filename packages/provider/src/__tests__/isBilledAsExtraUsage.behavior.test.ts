import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for isBilledAsExtraUsage. This predicate decides
 * whether a request is charged against the subscriber's "extra usage"
 * (paid metered) bucket vs included Pro/Max quota. Getting it wrong has
 * concrete monetary impact:
 *
 *   - True when should be false → user charged for included quota usage
 *   - False when should be true → ant backend rejects request after
 *     quota exhausted (subscriber would have wanted to keep working
 *     and pay the metered rate)
 *
 * The function combines four signals:
 *   1. Must be a Claude.ai subscriber (Pro/Max/Team/Enterprise)
 *   2. Fast mode is always billed extra (premium feature)
 *   3. 1M-context [1m] runs charge extra UNLESS opus1mMerged is true
 *      (opus47 pricing merged 1M into base quota)
 *   4. Only specific models qualify for extra-usage (opus 4.6/4.7,
 *      sonnet 4.6) — older models don't even attempt the 1M billing
 *      gate, fall through to false.
 */
describe('isBilledAsExtraUsage (ant Pro/Max usage flag parity)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'extraUsage.ts'),
    'utf-8',
  )

  test('non-subscriber → always false (Pro/Max-only feature)', () => {
    expect(source).toMatch(
      /if\s*\(!isClaudeAISubscriber\(\)\)\s*return false/,
    )
  })

  test('fast mode → always true (premium-feature billing)', () => {
    expect(source).toMatch(
      /if\s*\(isFastMode\)\s*return true/,
    )
  })

  test('null model or non-1m-context → false (no extra-usage path)', () => {
    expect(source).toMatch(
      /if\s*\(model === null \|\| !has1mContext\(model\)\)\s*return false/,
    )
  })

  test('strips [1m] suffix before model-name comparison', () => {
    // Without this, `claude-opus-4-7[1m]` wouldn't match `opus-4-7`.
    expect(source).toMatch(/\.replace\(\/\\\[1m\\\]\$\/,\s*''\)/)
  })

  test('opus aliases recognized (Opus 4.7, Opus 4.6, bare "opus")', () => {
    expect(source).toMatch(/m === 'opus' \|\| m\.includes\('opus-4-7'\) \|\| m\.includes\('opus-4-6'\)/)
  })

  test('sonnet 4.6 alias recognized (sonnet, sonnet-4-6) — sonnet-4-5 explicitly NOT', () => {
    // sonnet-4-5 doesn't get extra-usage billing because the 1M-context
    // option wasn't GA at that point. Pin the exclusion by what's MISSING.
    expect(source).toMatch(/isSonnet46 = m === 'sonnet' \|\| m\.includes\('sonnet-4-6'\)/)
    // No sonnet-4-5 anywhere
    expect(source).not.toMatch(/sonnet-4-5/)
  })

  test('opus1mMerged short-circuits opus to false (1M merged into base pricing)', () => {
    expect(source).toMatch(
      /if\s*\(isOpus && isOpus1mMerged\)\s*return false/,
    )
  })

  test('final return: opus OR sonnet46 is billed extra', () => {
    expect(source).toMatch(/return isOpus \|\| isSonnet46/)
  })
})
