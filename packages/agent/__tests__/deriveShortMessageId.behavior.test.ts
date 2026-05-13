import { describe, expect, test } from 'bun:test'

import { deriveShortMessageId } from '../messages.ts'

/**
 * Pin deriveShortMessageId — deterministic UUID → 6-char base36 hash.
 * Used by the snip tool to inject [id:...] tags into API-bound messages
 * so the model can reference earlier messages by short ID.
 *
 * Two critical invariants:
 *  1. Deterministic — same UUID ALWAYS produces same short ID.
 *     The model is shown these IDs across multiple turns; the mapping
 *     can't drift mid-session.
 *  2. Bounded length (6 chars) — IDs must be visually distinguishable
 *     in the API stream without bloating context.
 */
describe('deriveShortMessageId', () => {
  test('deterministic: same UUID → same short ID', () => {
    const uuid = '12345678-1234-1234-1234-123456789abc'
    const id1 = deriveShortMessageId(uuid)
    const id2 = deriveShortMessageId(uuid)
    expect(id1).toBe(id2)
  })

  test('output length ≤ 6 chars (bounded)', () => {
    // First 10 hex chars converted to base36 = at most 6 chars.
    // 0xffffffffff = 1099511627775 → base36 'fdkj4tzg' → sliced to 6 = 'fdkj4t'
    for (let i = 0; i < 20; i++) {
      const randomHex = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join('')
      const uuid = `${randomHex.slice(0, 8)}-${randomHex.slice(8, 12)}-${randomHex.slice(12, 16)}-${randomHex.slice(16, 20)}-${randomHex.slice(20, 32)}`
      const id = deriveShortMessageId(uuid)
      expect(id.length).toBeLessThanOrEqual(6)
      expect(id.length).toBeGreaterThan(0)
    }
  })

  test('strips dashes before hex conversion', () => {
    // Pin so a refactor that does .substring(0,10) without strip doesn't
    // produce wrong IDs (would see the first dash as a hex digit, fail parse).
    const id1 = deriveShortMessageId('12345678-1234-1234-1234-123456789abc')
    // Same hex without the dashes inserted should give the same first 10:
    // raw first 10 hex of "12345678123412341234..." is "1234567812"
    const id2 = deriveShortMessageId('12345678123-4-1234-1234-1234-123456789ab')
    // Stripping all dashes gives same first 10 hex: "1234567812"
    expect(id1).toBe(id2)
  })

  test('different UUIDs typically produce different IDs (entropy)', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const randomHex = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join('')
      const uuid = `${randomHex.slice(0, 8)}-${randomHex.slice(8, 12)}-${randomHex.slice(12, 16)}-${randomHex.slice(16, 20)}-${randomHex.slice(20, 32)}`
      ids.add(deriveShortMessageId(uuid))
    }
    // Allow some collision but most should be unique (10 hex chars = ~40
    // bits → tiny collision chance in 50 samples)
    expect(ids.size).toBeGreaterThanOrEqual(45)
  })

  test('returns base36-charset (lowercase alphanumeric)', () => {
    const id = deriveShortMessageId('abcdef01-2345-6789-abcd-ef0123456789')
    expect(id).toMatch(/^[0-9a-z]+$/)
  })

  test('handles UUIDs that produce zero (all leading zeros) — short result OK', () => {
    // 0x0000000000 = 0 → base36 "0" — sliced to 6 = "0".
    // Pin so the function doesn't crash and doesn't return "" for zero.
    const id = deriveShortMessageId('00000000-0000-0000-0000-000000000000')
    expect(id).toBe('0')
  })

  test('handles UUIDs that produce max (10 f\'s) → 6-char base36', () => {
    // 0xffffffffff = 1099511627775 → base36 → at most 8 chars → slice 6
    const id = deriveShortMessageId('ffffffff-ffff-ffff-ffff-ffffffffffff')
    expect(id.length).toBeLessThanOrEqual(6)
    expect(id.length).toBeGreaterThanOrEqual(1)
  })
})
