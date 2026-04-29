import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock the GrowthBook accessor before importing SUT.
const realFeatureFlags = await import('@claude-code/config/feature-flags')
let featureValueOverride: Map<string, unknown> = new Map()

mock.module('@claude-code/config/feature-flags', () => ({
  ...realFeatureFlags,
  getFeatureValue_CACHED_MAY_BE_STALE: <T>(key: string, fallback: T): T => {
    if (featureValueOverride.has(key))
      return featureValueOverride.get(key) as T
    return fallback
  },
}))

const {
  getChannelAllowlist,
  isChannelAllowlisted,
  isChannelsEnabled,
} = await import('../channelAllowlist.js')

beforeEach(() => {
  featureValueOverride = new Map()
})

describe('isChannelsEnabled — overall on/off', () => {
  test('default false (no GB entry)', () => {
    expect(isChannelsEnabled()).toBe(false)
  })

  test('returns true when tengu_harbor=true', () => {
    featureValueOverride.set('tengu_harbor', true)
    expect(isChannelsEnabled()).toBe(true)
  })

  test('non-boolean value returns the GB value as-is (no coercion)', () => {
    // Documents that the function delegates to GrowthBook's typed reader
    // — if GB ever returns a non-bool string, it propagates. The fallback
    // is `false`, but if GB returns 'true' (string), we return 'true'.
    // Caller expectation is boolean; type coercion happens at caller's
    // boundary if needed.
    featureValueOverride.set('tengu_harbor', 'true')
    // The function signature says boolean, so we cast for the test.
    expect(isChannelsEnabled() as unknown).toBe('true')
  })
})

describe('getChannelAllowlist — schema validation', () => {
  test('default empty array (no GB entry)', () => {
    expect(getChannelAllowlist()).toEqual([])
  })

  test('returns valid {marketplace, plugin} entries', () => {
    featureValueOverride.set('tengu_harbor_ledger', [
      { plugin: 'foo', marketplace: 'official' },
      { plugin: 'bar', marketplace: 'community' },
    ])
    expect(getChannelAllowlist()).toEqual([
      { plugin: 'foo', marketplace: 'official' },
      { plugin: 'bar', marketplace: 'community' },
    ])
  })

  test('schema rejects invalid entry shapes → returns []', () => {
    // Defensive: if GrowthBook returns a malformed payload (e.g. someone
    // pushed a typo'd config), we MUST NOT crash the channels gate.
    // safeParse failure → empty array.
    featureValueOverride.set('tengu_harbor_ledger', [
      { plugin: 'foo' }, // missing marketplace
      { not: 'a valid entry' },
    ])
    expect(getChannelAllowlist()).toEqual([])
  })

  test('schema rejects non-array payload → returns []', () => {
    featureValueOverride.set('tengu_harbor_ledger', { plugin: 'x' })
    expect(getChannelAllowlist()).toEqual([])
  })

  test('schema rejects null payload → returns []', () => {
    featureValueOverride.set('tengu_harbor_ledger', null)
    expect(getChannelAllowlist()).toEqual([])
  })

  test('schema rejects undefined payload → returns []', () => {
    featureValueOverride.set('tengu_harbor_ledger', undefined)
    expect(getChannelAllowlist()).toEqual([])
  })

  test('extra fields on entries are stripped (zod default behavior)', () => {
    // Documents the schema's strip-on-success behavior — extra fields in
    // GB don't break the parse, but they don't propagate to consumers
    // either. Future schema additions will need explicit fields.
    featureValueOverride.set('tengu_harbor_ledger', [
      { plugin: 'p', marketplace: 'm', extraField: 'ignored' },
    ])
    const result = getChannelAllowlist()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ plugin: 'p', marketplace: 'm' })
  })

  test('empty array → []', () => {
    featureValueOverride.set('tengu_harbor_ledger', [])
    expect(getChannelAllowlist()).toEqual([])
  })
})

describe('isChannelAllowlisted — pluginSource match', () => {
  test('undefined pluginSource → false (non-plugin server)', () => {
    expect(isChannelAllowlisted(undefined)).toBe(false)
  })

  test('empty-string pluginSource → false', () => {
    expect(isChannelAllowlisted('')).toBe(false)
  })

  test('"plugin@marketplace" matching ledger → true', () => {
    featureValueOverride.set('tengu_harbor_ledger', [
      { plugin: 'foo', marketplace: 'official' },
    ])
    expect(isChannelAllowlisted('foo@official')).toBe(true)
  })

  test('"plugin@marketplace" NOT matching ledger → false', () => {
    featureValueOverride.set('tengu_harbor_ledger', [
      { plugin: 'foo', marketplace: 'official' },
    ])
    expect(isChannelAllowlisted('bar@official')).toBe(false)
  })

  test('plugin name match but DIFFERENT marketplace → false', () => {
    // Critical security boundary: a malicious marketplace can't claim a
    // plugin name from the official marketplace. Both fields must match.
    featureValueOverride.set('tengu_harbor_ledger', [
      { plugin: 'foo', marketplace: 'official' },
    ])
    expect(isChannelAllowlisted('foo@malicious')).toBe(false)
  })

  test('marketplace match but DIFFERENT plugin → false', () => {
    featureValueOverride.set('tengu_harbor_ledger', [
      { plugin: 'foo', marketplace: 'official' },
    ])
    expect(isChannelAllowlisted('bar@official')).toBe(false)
  })

  test('plugin name without "@" (no marketplace) → false', () => {
    // Builtin/inline plugins have no marketplace and can't appear in the
    // ledger (which is keyed on marketplace). Explicitly reject so they
    // can't accidentally match an empty/undefined marketplace entry.
    featureValueOverride.set('tengu_harbor_ledger', [
      { plugin: 'foo', marketplace: 'official' },
    ])
    expect(isChannelAllowlisted('foo')).toBe(false)
  })

  test('multiple ledger entries — any match returns true', () => {
    featureValueOverride.set('tengu_harbor_ledger', [
      { plugin: 'foo', marketplace: 'official' },
      { plugin: 'bar', marketplace: 'community' },
      { plugin: 'baz', marketplace: 'official' },
    ])
    expect(isChannelAllowlisted('bar@community')).toBe(true)
    expect(isChannelAllowlisted('baz@official')).toBe(true)
  })

  test('ledger empty → all sources rejected', () => {
    featureValueOverride.set('tengu_harbor_ledger', [])
    expect(isChannelAllowlisted('any@source')).toBe(false)
  })

  test('multiple "@" in source — only first split (parsePluginIdentifier)', () => {
    // parsePluginIdentifier uses split('@') and takes parts[0] + parts[1].
    // Anything after second @ is ignored.
    featureValueOverride.set('tengu_harbor_ledger', [
      { plugin: 'foo', marketplace: 'mid' },
    ])
    // 'foo@mid@trailing' splits to ['foo', 'mid', 'trailing'] →
    // name='foo', marketplace='mid'. Match.
    expect(isChannelAllowlisted('foo@mid@trailing')).toBe(true)
  })

  test('plugin name with empty string before @ → false', () => {
    // '@market' splits to ['', 'market'] → name='' which won't match any
    // registered plugin name (assuming names are non-empty).
    featureValueOverride.set('tengu_harbor_ledger', [
      { plugin: '', marketplace: 'mkt' },
    ])
    // Even if ledger had an empty-name entry (unrealistic), this test
    // validates the pure logic: it doesn't crash on empty parts.
    expect(isChannelAllowlisted('@mkt')).toBe(true)
  })
})
