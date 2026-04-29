import { describe, expect, test } from 'bun:test'
import {
  RATE_LIMIT_ERROR_PREFIXES,
  isRateLimitErrorMessage,
} from '../rateLimitMessages.js'

describe('RATE_LIMIT_ERROR_PREFIXES — contract', () => {
  test('contains exactly the 5 known prefixes (snapshot)', () => {
    // If a 6th prefix is added in rateLimitMessages.ts, this snapshot
    // forces the contributor to update isRateLimitErrorMessage's caller
    // sites that filter based on the prefix list. UI components match
    // these strings to decide whether to render the error in the bottom
    // bar or the message stream — adding a prefix without updating the
    // tuple silently breaks rate-limit display.
    expect(RATE_LIMIT_ERROR_PREFIXES).toEqual([
      "You've hit your",
      "You've used",
      "You're now using extra usage",
      "You're close to",
      "You're out of extra usage",
    ])
  })

  test('readonly tuple — TypeScript "as const"', () => {
    // The type system enforces immutability via `as const`, but at runtime
    // the array is still mutable. This test asserts the runtime sequence
    // (index order matters for prefix matching efficiency — most-common
    // prefixes should be earliest).
    expect(RATE_LIMIT_ERROR_PREFIXES.length).toBe(5)
  })
})

describe('isRateLimitErrorMessage — exact prefix matches', () => {
  test('"You\'ve hit your weekly limit" → true', () => {
    expect(isRateLimitErrorMessage("You've hit your weekly limit")).toBe(true)
  })

  test('"You\'ve used 80% of your..." → true', () => {
    expect(
      isRateLimitErrorMessage("You've used 80% of your weekly limit"),
    ).toBe(true)
  })

  test('"You\'re now using extra usage" → true', () => {
    expect(
      isRateLimitErrorMessage("You're now using extra usage · resets soon"),
    ).toBe(true)
  })

  test('"You\'re close to your extra usage spending limit" → true', () => {
    expect(
      isRateLimitErrorMessage(
        "You're close to your extra usage spending limit",
      ),
    ).toBe(true)
  })

  test('"You\'re out of extra usage" → true', () => {
    expect(isRateLimitErrorMessage("You're out of extra usage")).toBe(true)
  })
})

describe('isRateLimitErrorMessage — non-matches', () => {
  test('plain error message → false', () => {
    expect(isRateLimitErrorMessage('Network connection failed')).toBe(false)
  })

  test('empty string → false', () => {
    expect(isRateLimitErrorMessage('')).toBe(false)
  })

  test('substring of prefix at non-zero offset → false (startsWith semantics)', () => {
    // "Hello, You've hit your..." does NOT start with one of the
    // prefixes. Document the startsWith (NOT includes) contract.
    expect(isRateLimitErrorMessage("Hello, You've hit your weekly limit")).toBe(
      false,
    )
  })

  test('case-sensitive: "you\'ve hit your" → false', () => {
    // Documenting case-sensitivity. If the LLM-generated UI strings
    // accidentally lowercase the message, the rate-limit detector
    // misses it and the user sees the message in the wrong place.
    expect(isRateLimitErrorMessage("you've hit your weekly limit")).toBe(false)
  })

  test('different apostrophe (curly U+2019) → false', () => {
    // Documenting that smart quotes don't match. If a future copy-edit
    // pass replaces ' with ', the prefix list must update too.
    expect(isRateLimitErrorMessage('You\u2019ve hit your weekly limit')).toBe(
      false,
    )
  })

  test('truncated prefix → false', () => {
    // Less than the full prefix doesn't match. "You've hit your" is the
    // exact prefix; "You've hit you" is one char short.
    expect(isRateLimitErrorMessage("You've hit you")).toBe(false)
  })
})

describe('isRateLimitErrorMessage — edge', () => {
  test('exact prefix only (no suffix) → true', () => {
    // The whole prefix without trailing context still counts. The check
    // is text.startsWith(prefix), so the prefix matches itself.
    expect(isRateLimitErrorMessage("You've hit your")).toBe(true)
  })

  test('prefix followed by punctuation → true', () => {
    expect(isRateLimitErrorMessage("You've hit your.")).toBe(true)
  })

  test('multi-line text — only first line matters', () => {
    // .startsWith doesn't care about newlines.
    expect(
      isRateLimitErrorMessage("You've hit your weekly limit\nDetails here"),
    ).toBe(true)
  })
})
