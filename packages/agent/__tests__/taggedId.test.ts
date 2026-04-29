import { describe, expect, test } from 'bun:test'
import { toTaggedId } from '../taggedId.js'

describe('toTaggedId', () => {
  test('produces tag_<version><22 base58 chars> format', () => {
    const id = toTaggedId('user', '01234567-89ab-cdef-0123-456789abcdef')
    expect(id.startsWith('user_01')).toBe(true)
    // user_ + 01 + 22 base58 = 5 + 2 + 22 = 29
    expect(id.length).toBe(29)
  })

  test('accepts UUID with hyphens', () => {
    const withHyphens = toTaggedId('org', '12345678-1234-5678-1234-567812345678')
    expect(withHyphens.startsWith('org_01')).toBe(true)
  })

  test('accepts UUID without hyphens', () => {
    const noHyphens = toTaggedId('org', '12345678123456781234567812345678')
    expect(noHyphens.startsWith('org_01')).toBe(true)
  })

  test('hyphenated and unhyphenated form of same UUID produce identical id', () => {
    const a = toTaggedId('user', '01234567-89ab-cdef-0123-456789abcdef')
    const b = toTaggedId('user', '0123456789abcdef0123456789abcdef')
    expect(a).toBe(b)
  })

  test('throws on invalid UUID length', () => {
    expect(() => toTaggedId('user', '0123456789abcdef')).toThrow(/length/)
    expect(() => toTaggedId('user', 'short')).toThrow(/length/)
  })

  test('different UUIDs produce different ids', () => {
    const a = toTaggedId('user', '01234567-89ab-cdef-0123-456789abcdef')
    const b = toTaggedId('user', 'ffffffff-ffff-ffff-ffff-ffffffffffff')
    expect(a).not.toBe(b)
  })

  test('zero UUID produces leading 1s (base58 alphabet starts with 1)', () => {
    // zero → all 1s in base58 (since 1 is the 0-position char)
    const id = toTaggedId('user', '00000000-0000-0000-0000-000000000000')
    expect(id).toBe('user_01' + '1'.repeat(22))
  })

  test('does not allow tag with underscore (would parse ambiguously) — caller responsibility', () => {
    // Documenting: function passes tag through; caller must ensure tag has no _.
    // This test just confirms the literal tag is preserved.
    const id = toTaggedId('multi_word', '01234567-89ab-cdef-0123-456789abcdef')
    expect(id.startsWith('multi_word_01')).toBe(true)
  })

  test('output uses base58 alphabet only (no 0/O/I/l)', () => {
    const id = toTaggedId('user', 'ffffffff-ffff-ffff-ffff-ffffffffffff')
    const encoded = id.slice('user_01'.length)
    expect(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(encoded)).toBe(true)
  })
})
