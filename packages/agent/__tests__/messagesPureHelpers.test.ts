import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import {
  deriveShortMessageId,
  deriveUUID,
  extractTag,
} from '../messages.js'

describe('deriveShortMessageId — UUID → short ID', () => {
  test('produces a 6-char string', () => {
    const id = deriveShortMessageId('550e8400-e29b-41d4-a716-446655440000')
    expect(id.length).toBeGreaterThan(0)
    expect(id.length).toBeLessThanOrEqual(6)
  })

  test('deterministic — same UUID always produces same ID', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(deriveShortMessageId(uuid)).toBe(deriveShortMessageId(uuid))
  })

  test('different UUIDs typically produce different IDs', () => {
    const a = deriveShortMessageId('550e8400-e29b-41d4-a716-446655440000')
    const b = deriveShortMessageId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    // Not a guarantee (base36 truncated to 6 chars has ~2.18 billion variants),
    // but for these specific UUIDs the prefixes are different enough that
    // collision is astronomically unlikely.
    expect(a).not.toBe(b)
  })

  test('UUID without dashes also handled (replaceAll handles missing)', () => {
    // The replace(/-/g, '') is a no-op if there are no dashes. The function
    // takes the first 10 hex chars regardless of dash placement.
    const id = deriveShortMessageId('550e8400e29b41d4a716446655440000')
    expect(id.length).toBeGreaterThan(0)
  })

  test('different first-10-hex-chars but same suffix → different IDs', () => {
    // Anchors that the function uses ONLY the first 10 hex chars.
    const a = deriveShortMessageId('00000000-0000-0000-0000-000000000000')
    const b = deriveShortMessageId('11111111-0000-0000-0000-000000000000')
    expect(a).not.toBe(b)
  })

  test('same first-10-hex-chars, different suffix → SAME ID (only prefix matters)', () => {
    // Documents the truncation contract: anything past the 10th hex char
    // is ignored. Two UUIDs sharing the first 10 hex chars collide.
    const a = deriveShortMessageId('00000000-0000-1111-1111-111111111111')
    const b = deriveShortMessageId('00000000-0000-2222-2222-222222222222')
    expect(a).toBe(b)
  })

  test('ID uses base36 (lowercase a-z + 0-9)', () => {
    const id = deriveShortMessageId('ffffffff-ffff-ffff-ffff-ffffffffffff')
    expect(id).toMatch(/^[0-9a-z]+$/)
  })

  test('zero UUID → "0" base36', () => {
    expect(deriveShortMessageId('00000000-0000-0000-0000-000000000000')).toBe('0')
  })
})

describe('deriveUUID — deterministic key derivation', () => {
  test('produces a UUID-shaped string with parent prefix preserved', () => {
    const parent = '550e8400-e29b-41d4-a716-446655440000' as UUID
    const r = deriveUUID(parent, 0)
    expect(r.startsWith('550e8400-e29b-41d4-a716')).toBe(true)
  })

  test('deterministic — same parent + index produces same UUID', () => {
    const parent = '550e8400-e29b-41d4-a716-446655440000' as UUID
    expect(deriveUUID(parent, 0)).toBe(deriveUUID(parent, 0))
    expect(deriveUUID(parent, 5)).toBe(deriveUUID(parent, 5))
  })

  test('different indexes → different UUIDs (suffix derived from index)', () => {
    const parent = '550e8400-e29b-41d4-a716-446655440000' as UUID
    expect(deriveUUID(parent, 0)).not.toBe(deriveUUID(parent, 1))
    expect(deriveUUID(parent, 1)).not.toBe(deriveUUID(parent, 2))
  })

  test('index 0 produces zero-padded suffix', () => {
    const parent = '00000000-0000-0000-0000-000000000000' as UUID
    expect(deriveUUID(parent, 0)).toBe(
      '00000000-0000-0000-0000-000000000000' as UUID,
    )
  })

  test('index 1 produces "...000000000001" suffix', () => {
    const parent = '00000000-0000-0000-0000-000000000000' as UUID
    expect(deriveUUID(parent, 1)).toBe(
      '00000000-0000-0000-0000-000000000001' as UUID,
    )
  })

  test('index 255 produces "...0000000000ff" suffix (hex padding)', () => {
    const parent = '00000000-0000-0000-0000-000000000000' as UUID
    expect(deriveUUID(parent, 255)).toBe(
      '00000000-0000-0000-0000-0000000000ff' as UUID,
    )
  })

  test('large index up to 12-hex-char limit', () => {
    const parent = '00000000-0000-0000-0000-000000000000' as UUID
    const max = 0xffffffffffff // 2^48 - 1
    expect(deriveUUID(parent, max)).toBe(
      '00000000-0000-0000-0000-ffffffffffff' as UUID,
    )
  })

  test('different parents produce different UUIDs', () => {
    const p1 = '550e8400-e29b-41d4-a716-446655440000' as UUID
    const p2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as UUID
    expect(deriveUUID(p1, 0)).not.toBe(deriveUUID(p2, 0))
  })
})

describe('extractTag — XML/HTML tag content extraction', () => {
  test('simple tag extraction', () => {
    expect(extractTag('<foo>hello</foo>', 'foo')).toBe('hello')
  })

  test('tag with attributes', () => {
    expect(extractTag('<foo bar="baz">content</foo>', 'foo')).toBe('content')
  })

  test('multiple attributes', () => {
    expect(extractTag('<foo a="1" b="2">x</foo>', 'foo')).toBe('x')
  })

  test('multiline content preserved', () => {
    expect(extractTag('<foo>line1\nline2\nline3</foo>', 'foo')).toBe(
      'line1\nline2\nline3',
    )
  })

  test('case-insensitive tag matching', () => {
    // The regex is built with 'gi' flag.
    expect(extractTag('<FOO>hi</FOO>', 'foo')).toBe('hi')
    expect(extractTag('<foo>hi</foo>', 'FOO')).toBe('hi')
  })

  test('tag not present → null', () => {
    expect(extractTag('<bar>hi</bar>', 'foo')).toBeNull()
  })

  test('empty content → null (function returns null on empty)', () => {
    // The regex captures the content; empty content fails the depth check
    // (`if (depth === 0 && content)`) because '' is falsy.
    expect(extractTag('<foo></foo>', 'foo')).toBeNull()
  })

  test('empty html → null', () => {
    expect(extractTag('', 'foo')).toBeNull()
  })

  test('whitespace-only html → null', () => {
    expect(extractTag('   ', 'foo')).toBeNull()
  })

  test('empty tagName → null', () => {
    expect(extractTag('<foo>x</foo>', '')).toBeNull()
  })

  test('whitespace-only tagName → null', () => {
    expect(extractTag('<foo>x</foo>', '   ')).toBeNull()
  })

  test('returns FIRST match when multiple instances exist', () => {
    expect(extractTag('<foo>first</foo><foo>second</foo>', 'foo')).toBe('first')
  })

  test('regex special chars in tagName escaped', () => {
    // The function uses escapeRegExp on tagName. Tag names with dots etc.
    // (uncommon but theoretically possible in custom XML) should still work.
    expect(extractTag('<foo.bar>x</foo.bar>', 'foo.bar')).toBe('x')
  })

  test('nested tags — outer tag content captured (non-greedy match within depth=0)', () => {
    // Function tracks depth — only matches that are at depth 0 are returned.
    // The non-greedy match grabs the FIRST closing tag.
    const r = extractTag('<a><b>inner</b></a>', 'a')
    // Inner is captured because the outer's content INCLUDES the nested tags.
    expect(r).toBe('<b>inner</b>')
  })

  test('content with HTML entities preserved (no decoding)', () => {
    expect(extractTag('<foo>&amp;hello</foo>', 'foo')).toBe('&amp;hello')
  })

  test('self-closing-style tags (no content) → null', () => {
    // <foo/> has no content. The function looks for <foo>...</foo>, so
    // a self-closing tag doesn't match the pattern at all.
    expect(extractTag('<foo/>', 'foo')).toBeNull()
  })
})
