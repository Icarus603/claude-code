import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for getAllModelBetas / getMergedBetas / clearBetasCaches
 * (ccb betas.ts) vs ant ux/SQ_/CQ_ (1988.js).
 *
 * Each beta header gates a backend feature. Wrong order, wrong predicate,
 * or wrong cache invalidation causes silent feature loss (e.g., subscriber
 * sees Claude.ai OAuth header missing → server treats them as API user →
 * wrong rate limit bucket, wrong pricing).
 */
describe('betas.ts header assembly (ant ux/SQ_/CQ_)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'betas.ts'),
    'utf-8',
  )

  describe('getAllModelBetas', () => {
    const fnStart = source.indexOf('export const getAllModelBetas = memoize')
    const fnSlice = source.slice(fnStart, fnStart + 4000)

    test('CLAUDE_CODE_20250219_BETA_HEADER added for non-Haiku models', () => {
      expect(fnSlice).toMatch(
        /if\s*\(!isHaiku\)\s*\{[\s\S]*?betaHeaders\.push\(CLAUDE_CODE_20250219_BETA_HEADER\)/,
      )
    })

    test('OAUTH_BETA_HEADER added when isClaudeAISubscriber (subscriber gate)', () => {
      // This is the load-bearing gate: server treats requests with this
      // header as subscriber traffic (Pro/Max rate limits + pricing). Drop
      // this and subscribers silently fall back to API rates.
      expect(fnSlice).toMatch(
        /if\s*\(isClaudeAISubscriber\(\)\)\s*\{?\s*\n?\s*betaHeaders\.push\(OAUTH_BETA_HEADER\)/,
      )
    })

    test('CONTEXT_1M_BETA_HEADER gated on has1mContext(model)', () => {
      expect(fnSlice).toMatch(
        /if\s*\(has1mContext\(model\)\)\s*\{?\s*\n?\s*betaHeaders\.push\(CONTEXT_1M_BETA_HEADER\)/,
      )
    })

    test('INTERLEAVED_THINKING_BETA_HEADER respects DISABLE_INTERLEAVED_THINKING env', () => {
      expect(fnSlice).toMatch(
        /!isEnvTruthy\(readEnv\('DISABLE_INTERLEAVED_THINKING'\)\)\s*&&\s*\n?\s*modelSupportsISP\(model\)/,
      )
    })

    test('REDACT_THINKING_BETA_HEADER skipped when showThinkingSummaries=true', () => {
      // Pin the interactive + showThinkingSummaries gate. Default behavior
      // for the CLI is to redact thinking (header on); only the user
      // explicitly opting in via settings flips it off.
      expect(fnSlice).toMatch(
        /getInitialSettings\(\)\.showThinkingSummaries !== true/,
      )
    })

    test('ANTHROPIC_BETAS env var splits on comma and trims (escape hatch)', () => {
      expect(fnSlice).toMatch(
        /readEnv\('ANTHROPIC_BETAS'\)\.split\(','\)[\s\S]{0,100}\.map\([^)]+=>\s*[^)]+\.trim\(\)\)[\s\S]{0,40}\.filter\(Boolean\)/,
      )
    })
  })

  describe('getMergedBetas', () => {
    const fnStart = source.indexOf('export function getMergedBetas')
    const fnSlice = source.slice(fnStart, fnStart + 1500)

    test('agentic-query injection skipped when CLAUDE_CODE_20250219 already present', () => {
      // Pin the de-dup: getAllModelBetas already adds CLAUDE_CODE_20250219
      // for non-Haiku; the agentic-query path adds it ONLY when missing,
      // so non-Haiku calls don't get the header twice (server rejects
      // duplicate beta headers).
      expect(fnSlice).toMatch(
        /if\s*\(!baseBetas\.includes\(CLAUDE_CODE_20250219_BETA_HEADER\)\)\s*\{?\s*\n?\s*baseBetas\.push\(CLAUDE_CODE_20250219_BETA_HEADER\)/,
      )
    })

    test('SDK-provided betas merged via sanitizeBetaHeaders (dedupe)', () => {
      expect(fnSlice).toMatch(
        /sanitizeBetaHeaders\(\[\s*\n?\s*\.\.\.baseBetas,\s*\n?\s*\.\.\.sdkBetas\.filter\(b => !baseBetas\.includes\(b\)\)/,
      )
    })

    test('empty/missing SDK betas → returns baseBetas unchanged (no sanitize round-trip)', () => {
      expect(fnSlice).toMatch(
        /if\s*\(!sdkBetas \|\| sdkBetas\.length === 0\)\s*\{?\s*\n?\s*return baseBetas/,
      )
    })
  })

  describe('cache invalidation', () => {
    test('clearBetasCaches clears all three memoized caches (ant CQ_)', () => {
      expect(source).toMatch(/getAllModelBetas\.cache\?\.clear\?\.\(\)/)
      expect(source).toMatch(/getModelBetas\.cache\?\.clear\?\.\(\)/)
      expect(source).toMatch(/getBedrockExtraBodyParamsBetas\.cache\?\.clear\?\.\(\)/)
    })

    test('sanitizeBetaHeaders dedupes via Set + trims empty (ant)', () => {
      expect(source).toMatch(
        /new Set\(betas\.map\(beta => beta\.trim\(\)\)\.filter\(beta => beta\.length > 0\)\)/,
      )
    })
  })
})
