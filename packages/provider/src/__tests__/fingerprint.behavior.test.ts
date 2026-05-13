import { describe, expect, test } from 'bun:test'

import { createHash } from 'crypto'
import {
  FINGERPRINT_SALT,
  computeFingerprint,
  extractFirstMessageText,
} from '../fingerprint.ts'

/**
 * Pin fingerprint algorithm. The doc comment explicitly says:
 *
 *   "IMPORTANT: Do not change this method without careful coordination with
 *    1P and 3P (Bedrock, Vertex, Azure) APIs."
 *
 * The backend validates the fingerprint against its own SHA256 computation
 * using the same SALT, character indices, and version concatenation order.
 * Any drift here breaks attribution: the backend sees "claude-code" claim
 * with mismatching fingerprint and rejects/discards the analytics record.
 */
describe('fingerprint algorithm (backend-validated, DO NOT CHANGE)', () => {
  test('FINGERPRINT_SALT is the exact backend-coordinated value', () => {
    // This salt is documented as "hardcoded from backend validation" —
    // changing it breaks attribution across ALL Anthropic 1P + 3P APIs.
    expect(FINGERPRINT_SALT).toBe('59cf53e54c78')
  })

  test('character indices [4, 7, 20] from first message text', () => {
    // The algorithm samples 3 specific characters. Pin so a refactor
    // doesn't change the indices (which would silently produce different
    // fingerprints for the same input).
    const msgText = 'abcdefghijklmnopqrstuvwxyz'
    // Index 4='e', 7='h', 20='u'
    const expected = createHash('sha256')
      .update(`${FINGERPRINT_SALT}ehuv1.2.3`)
      .digest('hex')
      .slice(0, 3)
    expect(computeFingerprint(msgText, 'v1.2.3')).toBe(expected)
  })

  test('missing characters (short message) fill with "0"', () => {
    // Pin so a "let's tighten the math" refactor that uses undefined
    // instead of "0" doesn't produce different fingerprints for short
    // first messages.
    const shortMsg = 'hi'
    // Indices 4, 7, 20 all out of range → '000'
    const expected = createHash('sha256')
      .update(`${FINGERPRINT_SALT}000v1.0.0`)
      .digest('hex')
      .slice(0, 3)
    expect(computeFingerprint(shortMsg, 'v1.0.0')).toBe(expected)
  })

  test('output is exactly 3 hex chars (not 4, not full hash)', () => {
    const fp = computeFingerprint('any message', 'v1.0.0')
    expect(fp).toMatch(/^[0-9a-f]{3}$/)
    expect(fp.length).toBe(3)
  })

  test('version concatenates AFTER message chars (NOT before)', () => {
    // Order matters: `${SALT}${chars}${version}` (not `${SALT}${version}${chars}`).
    // Swapped order would produce different hash → backend rejection.
    const fp1 = computeFingerprint('abcdefghijklmnopqrstuvwxyz', 'v1.0.0')
    const expected = createHash('sha256')
      .update(`${FINGERPRINT_SALT}ehuv1.0.0`) // salt + chars + version
      .digest('hex')
      .slice(0, 3)
    expect(fp1).toBe(expected)
  })

  test('deterministic: same input → same fingerprint', () => {
    const fp1 = computeFingerprint('hello world', 'v1.0.0')
    const fp2 = computeFingerprint('hello world', 'v1.0.0')
    expect(fp1).toBe(fp2)
  })

  test('different versions → different fingerprints (proves version is in mix)', () => {
    const fp1 = computeFingerprint('hello world', 'v1.0.0')
    const fp2 = computeFingerprint('hello world', 'v1.0.1')
    expect(fp1).not.toBe(fp2)
  })

  describe('extractFirstMessageText', () => {
    test('string content → returned as-is', () => {
      const messages = [
        { type: 'user' as const, message: { content: 'plain string' } } as any,
      ]
      expect(extractFirstMessageText(messages)).toBe('plain string')
    })

    test('array content → first text block', () => {
      const messages = [
        {
          type: 'user' as const,
          message: {
            content: [
              { type: 'image', source: { data: 'xxx' } },
              { type: 'text', text: 'real message' },
            ],
          },
        } as any,
      ]
      expect(extractFirstMessageText(messages)).toBe('real message')
    })

    test('no user message → empty string', () => {
      const messages = [{ type: 'assistant' as const, message: { content: 'foo' } } as any]
      expect(extractFirstMessageText(messages)).toBe('')
    })

    test('array content with no text block → empty string', () => {
      const messages = [
        {
          type: 'user' as const,
          message: {
            content: [{ type: 'image', source: {} }],
          },
        } as any,
      ]
      expect(extractFirstMessageText(messages)).toBe('')
    })

    test('finds the FIRST user message (assistant precedes it)', () => {
      const messages = [
        { type: 'assistant' as const, message: { content: 'hi' } } as any,
        { type: 'user' as const, message: { content: 'user-msg' } } as any,
      ]
      expect(extractFirstMessageText(messages)).toBe('user-msg')
    })
  })
})
