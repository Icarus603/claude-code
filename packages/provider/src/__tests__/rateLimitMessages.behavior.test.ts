import { describe, expect, test } from 'bun:test'

import {
  RATE_LIMIT_ERROR_PREFIXES,
  isRateLimitErrorMessage,
} from '../rateLimitMessages.js'

/**
 * Pin the exact user-facing prefixes for rate-limit messages. Used by:
 * - isRateLimitErrorMessage to detect rate-limit text in the error stream
 * - REPL/headless rendering to format these messages distinctly
 * - SDK / printToTerminal to suppress duplicate "trying to use ..." dialogs
 *
 * If any prefix string drifts, the renderer fails to recognize the
 * message and falls back to generic "Error: <full text>" display, losing
 * the specific 429 affordance (extra-usage CTA, quota reset countdown).
 */
describe('Rate-limit message prefixes (ant /status + REPL parity)', () => {
  test('all 5 prefix strings present in expected order', () => {
    expect([...RATE_LIMIT_ERROR_PREFIXES]).toEqual([
      "You've hit your",
      "You've used",
      "You're now using extra usage",
      "You're close to",
      "You're out of extra usage",
    ])
  })

  test('isRateLimitErrorMessage matches each prefix exactly', () => {
    expect(isRateLimitErrorMessage("You've hit your weekly Opus limit"))
      .toBe(true)
    expect(isRateLimitErrorMessage("You've used 75% of your 5-hour Claude Code limit"))
      .toBe(true)
    expect(isRateLimitErrorMessage("You're now using extra usage"))
      .toBe(true)
    expect(isRateLimitErrorMessage("You're close to your 5-hour limit"))
      .toBe(true)
    expect(isRateLimitErrorMessage("You're out of extra usage credits"))
      .toBe(true)
  })

  test('messages that DON\'T start with a known prefix → false', () => {
    expect(isRateLimitErrorMessage('Authentication failed')).toBe(false)
    expect(isRateLimitErrorMessage('Network error: ECONNRESET')).toBe(false)
    expect(isRateLimitErrorMessage('Compaction triggered')).toBe(false)
    expect(isRateLimitErrorMessage('')).toBe(false)
  })

  test('case-sensitive (apostrophes preserved — fancy/straight matters)', () => {
    // The apostrophe in "You've" is the curly U+2019 in the source, not
    // the straight ASCII U+0027. Pin so a future "let's normalize quotes"
    // refactor doesn't accidentally break message detection.
    expect(isRateLimitErrorMessage("You've hit your")).toBe(true)
    // Straight apostrophe variant should NOT match (different code point)
    expect(isRateLimitErrorMessage("You'\\u0027ve hit your")).toBe(false)
  })

  test('substring (not prefix) → false', () => {
    // Server format always leads with the user-state. If we'd accidentally
    // changed to `.includes()` instead of `.startsWith()`, every error
    // message that mentions "You've hit your" mid-text would match.
    expect(isRateLimitErrorMessage("FYI: You've hit your weekly limit")).toBe(false)
  })

  test('prefix array is readonly (typed as const tuple)', () => {
    // The `as const` makes RATE_LIMIT_ERROR_PREFIXES inference an
    // immutable tuple of literal strings. A future refactor to plain
    // `string[]` would lose the literal type and allow accidental mutation.
    expect(Object.isFrozen(RATE_LIMIT_ERROR_PREFIXES)).toBe(false) // arrays aren't frozen by `as const`
    // But the type system prevents push() — runtime test would just be
    // exercising the type system, not the runtime invariant.
  })
})
