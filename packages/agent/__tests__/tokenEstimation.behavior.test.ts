import { describe, expect, test } from 'bun:test'

import {
  bytesPerTokenForFileType,
  roughTokenCountEstimation,
  roughTokenCountEstimationForFileType,
} from '../tokenEstimation.ts'

/**
 * Pin the offline token-estimation heuristics. These get called as a
 * fallback when the API-based token count isn't available (Bedrock, etc.)
 * AND for pre-flight size checks before submission.
 *
 * Underestimate → oversized tool results slip in, conversation hits
 *   "context limit exceeded" mid-task.
 * Overestimate → aggressive truncation, useful content dropped.
 *
 * CJK handling matters because Chinese/Japanese/Korean characters tokenize
 * roughly 1.5 tokens each on Claude's tokenizer, vs ~0.25 for ASCII.
 * Without CJK-aware estimation, Chinese-heavy CLAUDE.md files would
 * underestimate by ~6× and trigger context-limit errors unpredictably.
 */
describe('Token-count estimation heuristics', () => {
  describe('roughTokenCountEstimation', () => {
    test('plain ASCII: ~length/4 tokens', () => {
      const text = 'a'.repeat(400)
      expect(roughTokenCountEstimation(text)).toBe(100)
    })

    test('custom bytesPerToken ratio: length/N', () => {
      const text = 'a'.repeat(200)
      expect(roughTokenCountEstimation(text, 2)).toBe(100)
    })

    test('Chinese-heavy text: ~1.5 tokens per CJK char (CRITICAL — prevent underestimate)', () => {
      // 10 CJK chars × 1.5 ≈ 15 tokens
      const cjkText = '你好世界這是測試文字字符'
      const estimate = roughTokenCountEstimation(cjkText)
      // 12 CJK chars × 1.5 = 18
      expect(estimate).toBe(18)
    })

    test('mixed CJK + ASCII: each contributes via its own ratio', () => {
      // 4 CJK chars × 1.5 = 6, plus 8 ASCII chars / 4 = 2, total ~8
      const mixed = '你好世界abcdefgh'
      const estimate = roughTokenCountEstimation(mixed)
      expect(estimate).toBe(Math.round(8 / 4 + 4 * 1.5))
    })

    test('empty string → 0 (no crash)', () => {
      expect(roughTokenCountEstimation('')).toBe(0)
    })

    test('returns rounded integer (not float)', () => {
      // 7 chars / 4 = 1.75 → round to 2
      expect(roughTokenCountEstimation('abcdefg')).toBe(2)
    })
  })

  describe('bytesPerTokenForFileType', () => {
    test('json/jsonl/jsonc → 2 bytes/token (dense single-char tokens like {}:,)', () => {
      // CRITICAL: default is 4, but JSON is denser. Without this, a 100KB
      // JSON tool result estimated at 25K tokens actually consumes ~50K.
      expect(bytesPerTokenForFileType('json')).toBe(2)
      expect(bytesPerTokenForFileType('jsonl')).toBe(2)
      expect(bytesPerTokenForFileType('jsonc')).toBe(2)
    })

    test('everything else → 4 bytes/token (default)', () => {
      expect(bytesPerTokenForFileType('ts')).toBe(4)
      expect(bytesPerTokenForFileType('md')).toBe(4)
      expect(bytesPerTokenForFileType('txt')).toBe(4)
      expect(bytesPerTokenForFileType('py')).toBe(4)
      expect(bytesPerTokenForFileType('')).toBe(4)
    })
  })

  describe('roughTokenCountEstimationForFileType', () => {
    test('JSON content uses 2-byte ratio (CRITICAL safety: prevents context overflow)', () => {
      // 200 bytes of JSON → ~100 tokens (not 50 as default ratio would give)
      const json = '{"key":"value"}'.repeat(13) // ~200 bytes
      const est = roughTokenCountEstimationForFileType(json, 'json')
      expect(est).toBe(Math.round(json.length / 2))
    })

    test('TypeScript content uses default 4-byte ratio', () => {
      const ts = 'export function foo() { return 1 }\n'.repeat(10)
      const est = roughTokenCountEstimationForFileType(ts, 'ts')
      expect(est).toBe(Math.round(ts.length / 4))
    })
  })
})
