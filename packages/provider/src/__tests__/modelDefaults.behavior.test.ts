import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for getDefaultOpusModel/Sonnet/Haiku selection cascade.
 *
 * The cascade is provider-aware and ant-aligned:
 *   1. provider-specific env override (OPENAI/GEMINI_DEFAULT_*_MODEL)
 *   2. ANTHROPIC_DEFAULT_*_MODEL env override (applies to all anthropic providers)
 *   3. 3P-specific fallback (Bedrock/Vertex/Foundry get older version because
 *      cloud-provider availability LAGS firstParty)
 *   4. firstParty gets the latest version from getModelStrings()
 *
 * Bug history (V7 §11.6): the old `provider !== 'firstParty'` guard treated
 * a stale `'openai'` global provider (residue from a prior Codex session) as
 * 3P, downgrading Opus from 4.7 → 4.6 for a Claude Account subscriber.
 * Fixed by explicitly listing bedrock/vertex/foundry — pin the exact list.
 */
describe('Model defaults provider-aware cascade (vs ant default-resolver)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'model.ts'),
    'utf-8',
  )

  describe('getDefaultOpusModel', () => {
    const fnStart = source.indexOf('export function getDefaultOpusModel')
    const fnSlice = source.slice(fnStart, fnStart + 1500)

    test('OpenAI provider checks OPENAI_DEFAULT_OPUS_MODEL FIRST', () => {
      expect(fnSlice).toMatch(
        /provider === 'openai' && readEnv\('OPENAI_DEFAULT_OPUS_MODEL'\)/,
      )
    })

    test('Gemini provider checks GEMINI_DEFAULT_OPUS_MODEL FIRST', () => {
      expect(fnSlice).toMatch(
        /provider === 'gemini' && readEnv\('GEMINI_DEFAULT_OPUS_MODEL'\)/,
      )
    })

    test('Anthropic env override (ANTHROPIC_DEFAULT_OPUS_MODEL) checked after provider overrides', () => {
      const openaiIdx = fnSlice.indexOf("OPENAI_DEFAULT_OPUS_MODEL")
      const anthropicIdx = fnSlice.indexOf("ANTHROPIC_DEFAULT_OPUS_MODEL")
      expect(openaiIdx).toBeGreaterThan(0)
      expect(anthropicIdx).toBeGreaterThan(openaiIdx)
    })

    test('3P fallback list explicitly lists bedrock/vertex/foundry (NOT `!== firstParty`)', () => {
      // V7 §11.6 fix: stale `provider === 'openai'` from a prior session
      // would have falsely-matched `!== 'firstParty'` and downgraded Opus.
      expect(fnSlice).toMatch(
        /if\s*\(provider === 'bedrock' \|\| provider === 'vertex' \|\| provider === 'foundry'\)/,
      )
      expect(fnSlice).toMatch(/return getModelStrings\(\)\.opus46/)
    })

    test('firstParty (and connection-based) gets latest opus47', () => {
      expect(fnSlice).toMatch(/return getModelStrings\(\)\.opus47/)
    })
  })

  describe('getDefaultSonnetModel', () => {
    const fnStart = source.indexOf('export function getDefaultSonnetModel')
    const fnSlice = source.slice(fnStart, fnStart + 1500)

    test('provider-specific overrides → ANTHROPIC override → 3P fallback → firstParty', () => {
      expect(fnSlice).toMatch(/OPENAI_DEFAULT_SONNET_MODEL/)
      expect(fnSlice).toMatch(/GEMINI_DEFAULT_SONNET_MODEL/)
      expect(fnSlice).toMatch(/ANTHROPIC_DEFAULT_SONNET_MODEL/)
      expect(fnSlice).toMatch(/return getModelStrings\(\)\.sonnet45/) // 3P fallback
      expect(fnSlice).toMatch(/return getModelStrings\(\)\.sonnet46/) // firstParty
    })
  })
})
