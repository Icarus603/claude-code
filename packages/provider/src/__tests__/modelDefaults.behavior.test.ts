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
 * 3P, downgrading Opus from latest → 4.6 for a Claude Account subscriber.
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

    test('firstParty (and connection-based) gets latest opus48', () => {
      expect(fnSlice).toMatch(/return getModelStrings\(\)\.opus48/)
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

  /**
   * getSmallFastModel safety net — port of ant `wP` (1419.js), generalised
   * for ccb's connection registry.
   *
   * ant's load-bearing invariant: only return a Claude Haiku id when Claude
   * Haiku is GENUINELY REACHABLE; otherwise fall back to the main-loop model
   * (the one the user is actually on, guaranteed to route + authenticate).
   *
   * Bug this pins against: a user on a single OpenAI/Gemini/Codex connection
   * (no *_SMALL_FAST_MODEL set) used to get `claude-haiku-4-5` here →
   * resolveConnectionForModel can't match it → falls back to firstParty →
   * hits the Anthropic SDK with no Anthropic creds → 401. Background
   * classifiers / prompt-hook evaluators (/goal, away-summary, …) then fail
   * silently every turn.
   *
   * The fix MUST keep the reachability gate before returning Haiku, and MUST
   * fall back to getMainLoopModel() when Haiku isn't reachable.
   */
  describe('getSmallFastModel multi-provider safety net (ant wP port)', () => {
    const fnStart = source.indexOf('export function getSmallFastModel')
    const fnSlice = source.slice(fnStart, fnStart + 3400)

    test('explicit per-provider small-fast overrides win first', () => {
      expect(fnSlice).toMatch(/OPENAI_SMALL_FAST_MODEL/)
      expect(fnSlice).toMatch(/GEMINI_SMALL_FAST_MODEL/)
      expect(fnSlice).toMatch(/ANTHROPIC_SMALL_FAST_MODEL/)
    })

    test('explicit ANTHROPIC_DEFAULT_HAIKU_MODEL is trusted (ant wP)', () => {
      expect(fnSlice).toMatch(/ANTHROPIC_DEFAULT_HAIKU_MODEL/)
    })

    test('reachability gate: connection-aware Haiku check', () => {
      // The main-loop model must resolve to an anthropic-protocol connection
      // whose model list actually includes a Haiku entry.
      expect(fnSlice).toMatch(/resolveConnectionForModel/)
      expect(fnSlice).toMatch(/conn\.protocol === 'anthropic'/)
      expect(fnSlice).toMatch(/includes\('haiku'\)/)
    })

    test('reachability gate: env-only path mirrors ant (firstParty+real endpoint, or cloud 3P)', () => {
      expect(fnSlice).toMatch(/isFirstPartyAnthropicBaseUrl\(\)/)
      expect(fnSlice).toMatch(/provider === 'bedrock'/)
      expect(fnSlice).toMatch(/provider === 'vertex'/)
      expect(fnSlice).toMatch(/provider === 'foundry'/)
    })

    test('returns Haiku only when reachable, else falls back to main-loop model', () => {
      // The two reachability predicates gate the Haiku return…
      expect(fnSlice).toMatch(
        /if \(haikuReachableViaConnection \|\| haikuReachableViaEnv\)/,
      )
      expect(fnSlice).toMatch(/return getDefaultHaikuModel\(\)/)
      // …and the final fallback is the main-loop model (ant wP `return F7()`),
      // NOT a bare Claude Haiku id that would 404/401 off-Anthropic.
      expect(fnSlice).toMatch(/return mainLoopModel/)
    })
  })
})
