import { describe, expect, test } from 'bun:test'

import { normalizeApiKeyForConfig } from '../authPortable.ts'

/**
 * Pin normalizeApiKeyForConfig (ant CS, 1259.js). Used to derive the
 * cache key stored in customApiKeyResponses.approved[]. The last-20-chars
 * derivation is intentional:
 *
 * - Short enough to NOT be a full secret (limits damage if config leaks)
 * - Long enough to be a stable identifier (Anthropic API keys have a
 *   prefix that's recoverable from context, so the trailing portion is
 *   the unique part)
 * - Matches what /login persistence wrote, so re-running CLI on a
 *   different machine with the same key gets recognized without
 *   re-approving.
 *
 * If this drifts (slice(-16) or slice(-24), or hash-based), all existing
 * approved-key entries orphan and the user re-sees the approval dialog
 * on every CLI run.
 */
describe('normalizeApiKeyForConfig (ant CS parity)', () => {
  test('returns the LAST 20 chars (slice(-20))', () => {
    const key = 'sk-ant-api03-' + 'a'.repeat(50)
    expect(normalizeApiKeyForConfig(key)).toBe(key.slice(-20))
    expect(normalizeApiKeyForConfig(key).length).toBe(20)
  })

  test('short key (< 20 chars) returns the WHOLE key (slice() handles this)', () => {
    // slice(-N) when N > length returns the full string. Pin this so
    // a future refactor that pads or rejects short keys doesn't break
    // unit tests using mock 12-char keys.
    expect(normalizeApiKeyForConfig('abc12345')).toBe('abc12345')
  })

  test('20-char key returns identity (boundary)', () => {
    const exactly20 = 'abcdef1234567890wxyz'
    expect(normalizeApiKeyForConfig(exactly20)).toBe(exactly20)
  })

  test('21-char key returns last 20 (drops the first char)', () => {
    expect(normalizeApiKeyForConfig('Xabcdef1234567890wxyz')).toBe(
      'abcdef1234567890wxyz',
    )
  })

  test('empty input returns empty', () => {
    // slice(-20) on '' is ''. Defensive: pin against future refactors
    // that throw on empty (would crash isCustomApiKeyApproved path).
    expect(normalizeApiKeyForConfig('')).toBe('')
  })

  test('deterministic (same input → same output, no random salt)', () => {
    const key = 'sk-ant-api03-' + 'b'.repeat(50)
    expect(normalizeApiKeyForConfig(key)).toBe(normalizeApiKeyForConfig(key))
  })

  test('different keys → different normalized forms (for typical Anthropic key shape)', () => {
    // Real keys differ in the random-suffix portion; last-20 captures that.
    expect(normalizeApiKeyForConfig('sk-ant-api03-' + 'a'.repeat(50))).not.toBe(
      normalizeApiKeyForConfig('sk-ant-api03-' + 'b'.repeat(50)),
    )
  })

  test('NOT a hash — pin against potential refactor to crypto.createHash', () => {
    // ant CS = H.slice(-20). If anyone replaces this with a hash for
    // "security", all existing config entries orphan. Pin the
    // pure-string-slice property by checking output is a substring of input.
    const key = 'sk-ant-api03-XXXXXXXXXXXXXXXXXXXX'
    expect(key.endsWith(normalizeApiKeyForConfig(key))).toBe(true)
  })
})
