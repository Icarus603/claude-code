/**
 * Tests for settings cache module — multiple stateful caches:
 *   - sessionSettings: the merged settings + errors used by /resume etc.
 *   - perSource: settings.json content by source (user/project/local)
 *   - parseFile: path-keyed disk-parse dedup
 *   - pluginSettingsBase: lowest-priority cascade layer from plugins
 *
 * Wrong invalidation → stale settings (user edit appears not to take
 * effect) OR cache thrash (every listener triggers a full disk reload).
 *
 * The cache lookup convention is documented:
 *   undefined  → cache miss (caller must compute)
 *   null       → cached "no settings for this source" (caller skips disk)
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import {
  clearPluginSettingsBase,
  getCachedParsedFile,
  getCachedSettingsForSource,
  getPluginSettingsBase,
  getSessionSettingsCache,
  resetSettingsCache,
  setCachedParsedFile,
  setCachedSettingsForSource,
  setPluginSettingsBase,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'

beforeEach(() => {
  resetSettingsCache()
  clearPluginSettingsBase()
})
afterEach(() => {
  resetSettingsCache()
  clearPluginSettingsBase()
})

describe('sessionSettingsCache', () => {
  test('initial value is null', () => {
    expect(getSessionSettingsCache()).toBeNull()
  })

  test('set + get round-trips', () => {
    const value = { settings: { env: { FOO: '1' } }, errors: [] } as never
    setSessionSettingsCache(value)
    expect(getSessionSettingsCache()).toBe(value)
  })

  test('reset clears the cache', () => {
    setSessionSettingsCache({ settings: {}, errors: [] } as never)
    resetSettingsCache()
    expect(getSessionSettingsCache()).toBeNull()
  })

  test('overwrite replaces previous value', () => {
    const a = { settings: { a: 1 }, errors: [] } as never
    const b = { settings: { b: 2 }, errors: [] } as never
    setSessionSettingsCache(a)
    setSessionSettingsCache(b)
    expect(getSessionSettingsCache()).toBe(b)
  })
})

describe('perSourceCache — undefined vs null discrimination', () => {
  test('initial → undefined (cache miss)', () => {
    expect(getCachedSettingsForSource('userSettings')).toBeUndefined()
  })

  test('cached null → null (cached "no settings")', () => {
    setCachedSettingsForSource('userSettings', null)
    expect(getCachedSettingsForSource('userSettings')).toBeNull()
  })

  test('cached settings object → returned verbatim', () => {
    const settings = { env: { FOO: '1' } } as never
    setCachedSettingsForSource('userSettings', settings)
    expect(getCachedSettingsForSource('userSettings')).toBe(settings)
  })

  test('different sources are independent', () => {
    setCachedSettingsForSource('userSettings', { x: 1 } as never)
    setCachedSettingsForSource('projectSettings', null)
    expect(getCachedSettingsForSource('userSettings')).toEqual({
      x: 1,
    } as never)
    expect(getCachedSettingsForSource('projectSettings')).toBeNull()
    expect(getCachedSettingsForSource('localSettings')).toBeUndefined()
  })

  test('reset clears all sources', () => {
    setCachedSettingsForSource('userSettings', { a: 1 } as never)
    setCachedSettingsForSource('projectSettings', null)
    resetSettingsCache()
    expect(getCachedSettingsForSource('userSettings')).toBeUndefined()
    expect(getCachedSettingsForSource('projectSettings')).toBeUndefined()
  })

  test('overwrite a cached value', () => {
    setCachedSettingsForSource('userSettings', { a: 1 } as never)
    setCachedSettingsForSource('userSettings', { b: 2 } as never)
    expect(getCachedSettingsForSource('userSettings')).toEqual({
      b: 2,
    } as never)
  })

  test('overwriting null with object works', () => {
    setCachedSettingsForSource('userSettings', null)
    setCachedSettingsForSource('userSettings', { a: 1 } as never)
    expect(getCachedSettingsForSource('userSettings')).toEqual({
      a: 1,
    } as never)
  })
})

describe('parseFileCache — path-keyed disk-parse dedup', () => {
  test('initial → undefined', () => {
    expect(getCachedParsedFile('/path/settings.json')).toBeUndefined()
  })

  test('set + get returns same parsed value', () => {
    const parsed = { settings: { x: 1 } as never, errors: [] }
    setCachedParsedFile('/foo.json', parsed)
    expect(getCachedParsedFile('/foo.json')).toBe(parsed)
  })

  test('different paths independent', () => {
    setCachedParsedFile('/a.json', { settings: null, errors: [] })
    setCachedParsedFile('/b.json', { settings: null, errors: [] })
    expect(getCachedParsedFile('/a.json')).toBeDefined()
    expect(getCachedParsedFile('/b.json')).toBeDefined()
    expect(getCachedParsedFile('/c.json')).toBeUndefined()
  })

  test('reset clears all paths', () => {
    setCachedParsedFile('/a.json', { settings: null, errors: [] })
    resetSettingsCache()
    expect(getCachedParsedFile('/a.json')).toBeUndefined()
  })

  test('errors array preserved on round-trip', () => {
    const parsed = {
      settings: null,
      errors: [{ path: 'env.X', message: 'bad', code: 'invalid_type' } as never],
    }
    setCachedParsedFile('/foo.json', parsed)
    expect(getCachedParsedFile('/foo.json')?.errors).toHaveLength(1)
  })
})

describe('resetSettingsCache atomicity', () => {
  test('clears all three caches in one call', () => {
    setSessionSettingsCache({ settings: {}, errors: [] } as never)
    setCachedSettingsForSource('userSettings', { x: 1 } as never)
    setCachedParsedFile('/path.json', { settings: null, errors: [] })
    resetSettingsCache()
    expect(getSessionSettingsCache()).toBeNull()
    expect(getCachedSettingsForSource('userSettings')).toBeUndefined()
    expect(getCachedParsedFile('/path.json')).toBeUndefined()
  })

  test('does NOT clear pluginSettingsBase (separate clearPluginSettingsBase)', () => {
    // Documented: pluginSettingsBase has its own lifecycle (set by
    // pluginLoader, cleared on session reset). resetSettingsCache only
    // affects merged/per-source/per-file caches.
    setPluginSettingsBase({ env: { X: '1' } })
    resetSettingsCache()
    expect(getPluginSettingsBase()).toEqual({ env: { X: '1' } })
  })
})

describe('pluginSettingsBase', () => {
  test('initial → undefined', () => {
    expect(getPluginSettingsBase()).toBeUndefined()
  })

  test('set + get round-trip', () => {
    setPluginSettingsBase({ env: { FOO: '1' } })
    expect(getPluginSettingsBase()).toEqual({ env: { FOO: '1' } })
  })

  test('overwrite replaces previous', () => {
    setPluginSettingsBase({ a: 1 })
    setPluginSettingsBase({ b: 2 })
    expect(getPluginSettingsBase()).toEqual({ b: 2 })
  })

  test('clearPluginSettingsBase resets to undefined', () => {
    setPluginSettingsBase({ a: 1 })
    clearPluginSettingsBase()
    expect(getPluginSettingsBase()).toBeUndefined()
  })

  test('setting undefined explicitly is supported', () => {
    setPluginSettingsBase({ a: 1 })
    setPluginSettingsBase(undefined)
    expect(getPluginSettingsBase()).toBeUndefined()
  })
})
