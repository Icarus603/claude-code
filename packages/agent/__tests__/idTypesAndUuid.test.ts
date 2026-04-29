import { describe, expect, test } from 'bun:test'
import { asAgentId, asSessionId, toAgentId } from '../idTypes.js'
import { createAgentId, validateUuid } from '../uuid.js'

describe('asSessionId / asAgentId — pure casts', () => {
  test('asSessionId is identity at runtime', () => {
    expect(asSessionId('abc')).toBe('abc' as never)
  })
  test('asAgentId is identity at runtime', () => {
    expect(asAgentId('xyz')).toBe('xyz' as never)
  })
})

describe('toAgentId — pattern validation', () => {
  test('accepts a + 16 hex chars (no label)', () => {
    expect(toAgentId('a0123456789abcdef')).toBe('a0123456789abcdef' as never)
  })
  test('accepts a<label>-<16 hex>', () => {
    expect(toAgentId('areviewer-0123456789abcdef')).toBe(
      'areviewer-0123456789abcdef' as never,
    )
  })
  test('rejects too-short hex', () => {
    expect(toAgentId('a012345')).toBeNull()
  })
  test('rejects non-hex chars', () => {
    expect(toAgentId('a0123456789ZZZZZZ')).toBeNull()
  })
  test('rejects without leading a', () => {
    expect(toAgentId('0123456789abcdef')).toBeNull()
  })
  test('rejects empty / random', () => {
    expect(toAgentId('')).toBeNull()
    expect(toAgentId('teammate@team')).toBeNull()
    expect(toAgentId('plain-name')).toBeNull()
  })
  test('round-trips with createAgentId output', () => {
    const id = createAgentId()
    expect(toAgentId(id)).toBe(id)
  })
  test('round-trips with createAgentId(label) output', () => {
    const id = createAgentId('reviewer')
    expect(toAgentId(id)).toBe(id)
  })
})

describe('createAgentId', () => {
  test('produces a + 16 hex without label', () => {
    const id = createAgentId()
    expect(/^a[0-9a-f]{16}$/.test(id)).toBe(true)
  })
  test('produces a<label>-<16 hex> with label', () => {
    const id = createAgentId('reviewer')
    expect(/^areviewer-[0-9a-f]{16}$/.test(id)).toBe(true)
  })
  test('produces unique ids across calls', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) ids.add(createAgentId())
    expect(ids.size).toBe(100)
  })
})

describe('validateUuid', () => {
  test('accepts canonical UUID v4 form', () => {
    const id = '01234567-89ab-cdef-0123-456789abcdef'
    expect(validateUuid(id)).toBe(id as never)
  })
  test('case-insensitive', () => {
    const upper = '01234567-89AB-CDEF-0123-456789ABCDEF'
    expect(validateUuid(upper)).toBe(upper as never)
  })
  test('rejects non-string input', () => {
    expect(validateUuid(123)).toBeNull()
    expect(validateUuid(null)).toBeNull()
    expect(validateUuid(undefined)).toBeNull()
    expect(validateUuid({})).toBeNull()
    expect(validateUuid([])).toBeNull()
  })
  test('rejects unhyphenated 32-char hex', () => {
    expect(validateUuid('0123456789abcdef0123456789abcdef')).toBeNull()
  })
  test('rejects wrong-length hex', () => {
    expect(validateUuid('01234567-89ab-cdef-0123-456789abcde')).toBeNull()
    expect(validateUuid('01234567-89ab-cdef-0123-456789abcdef0')).toBeNull()
  })
  test('rejects non-hex chars', () => {
    expect(validateUuid('01234567-89ab-cdef-0123-456789abcdeg')).toBeNull()
  })
  test('rejects empty and random', () => {
    expect(validateUuid('')).toBeNull()
    expect(validateUuid('not-a-uuid')).toBeNull()
  })
})
