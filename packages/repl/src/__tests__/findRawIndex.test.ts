/**
 * Tests for findRawIndex — locates a message by 24-char UUID prefix.
 *
 * The 24-char prefix is what survives `deriveUUID(parent, index)`
 * (which appends a 12-char hex suffix). So when you have a derived
 * UUID and want to find the original source message, this helper
 * prefix-matches it without an explicit lookup map.
 *
 * Wrong implementation (e.g., full-UUID compare) breaks the
 * derived-to-source bridge entirely; off-by-one in the slice length
 * makes spurious cross-message matches.
 */
import { describe, expect, test } from 'bun:test'
import { findRawIndex } from '../screens/repl/findRawIndex.js'

const MSG = (uuid: string) => ({ uuid }) as { uuid: string }

describe('findRawIndex — exact UUID match', () => {
  test('exact match returns its index', () => {
    const messages = [
      MSG('aaaa-bbbb-cccc-dddd-eeee-ffff'),
      MSG('1111-2222-3333-4444-5555-6666'),
      MSG('xxxx-yyyy-zzzz-wwww-vvvv-uuuu'),
    ]
    expect(findRawIndex(messages, '1111-2222-3333-4444-5555-6666')).toBe(1)
  })

  test('first element returns 0', () => {
    const messages = [MSG('aaaa-bbbb-cccc-dddd-eeee-ffff')]
    expect(findRawIndex(messages, 'aaaa-bbbb-cccc-dddd-eeee-ffff')).toBe(0)
  })

  test('not present returns -1', () => {
    const messages = [MSG('aaaa-bbbb-cccc-dddd-eeee-ffff')]
    expect(findRawIndex(messages, 'zzzz-yyyy-xxxx-wwww-vvvv-uuuu')).toBe(-1)
  })

  test('empty array returns -1', () => {
    expect(findRawIndex([], 'aaaa-bbbb-cccc-dddd-eeee-ffff')).toBe(-1)
  })
})

describe('findRawIndex — 24-char prefix match (derived UUIDs)', () => {
  test('derived UUID (first 24 chars match) finds original', () => {
    // Derived UUID: first 24 chars of original + 12 hex suffix.
    // Per deriveUUID: '00000000-0000-0000-0000-' (24 chars) + '000000000005'.
    const original = '00000000-0000-0000-0000-000000000000'
    const derived = '00000000-0000-0000-0000-000000000005'
    const messages = [MSG(original)]
    expect(findRawIndex(messages, derived)).toBe(0)
  })

  test('different first 24 chars: no match', () => {
    const messages = [MSG('00000000-0000-0000-0000-000000000000')]
    expect(findRawIndex(messages, '11111111-0000-0000-0000-000000000000')).toBe(
      -1,
    )
  })

  test('returns FIRST matching index when multiple share prefix', () => {
    // Both messages have same first 24 chars but different suffixes.
    // findIndex is documented to return the first match.
    const messages = [
      MSG('00000000-0000-0000-0000-000000000aaa'),
      MSG('00000000-0000-0000-0000-000000000bbb'),
    ]
    expect(
      findRawIndex(messages, '00000000-0000-0000-0000-000000000ccc'),
    ).toBe(0)
  })
})

describe('findRawIndex — search uuid shorter than 24 chars', () => {
  test('search uuid shorter than 24 chars: prefix is whatever the slice returns', () => {
    // slice(0, 24) on a short string returns the whole string.
    // Then comparison: m.uuid.slice(0, 24) is 24 chars, search prefix
    // is the short string. They never match unless source is also short.
    const messages = [MSG('aaaa-bbbb-cccc-dddd-eeee-ffff')]
    expect(findRawIndex(messages, 'short')).toBe(-1)
  })

  test('search uuid empty string: matches if message uuid first-24 is also empty', () => {
    // Pathological: an entry with empty uuid would match an empty
    // search string. Lock the behavior so a refactor can't change it.
    const messages = [MSG(''), MSG('something')]
    expect(findRawIndex(messages, '')).toBe(0)
  })
})

describe('findRawIndex — message uuid shorter than 24 chars', () => {
  test('source uuid shorter than 24: needs exact match on the short string', () => {
    // m.uuid.slice(0, 24) returns the whole uuid (since shorter than 24).
    // The comparison hits string equality on the actual uuid.
    const messages = [MSG('short')]
    // Search uuid first 24 chars must exactly equal 'short'.
    // 'short' === 'short' (both .slice(0, 24)) → match.
    expect(findRawIndex(messages, 'short')).toBe(0)
  })
})
