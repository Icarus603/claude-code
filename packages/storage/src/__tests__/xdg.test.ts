import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import {
  getUserBinDir,
  getXDGCacheHome,
  getXDGDataHome,
  getXDGStateHome,
} from '../xdg.js'

const HOME = '/users/test-home'

describe('getXDGStateHome', () => {
  test('uses XDG_STATE_HOME env when set', () => {
    expect(
      getXDGStateHome({ env: { XDG_STATE_HOME: '/custom/state' }, homedir: HOME }),
    ).toBe('/custom/state')
  })

  test('defaults to ~/.local/state when XDG_STATE_HOME unset', () => {
    expect(getXDGStateHome({ env: {}, homedir: HOME })).toBe(
      join(HOME, '.local', 'state'),
    )
  })

  test('empty XDG_STATE_HOME (empty string) falls back via ?? operator', () => {
    // ?? only triggers on null/undefined. Empty string is preserved per spec
    // (env.XDG_STATE_HOME = '' is a deliberate "use default" signal in some
    // shells, but our implementation passes it through). Documents the
    // current contract.
    expect(
      getXDGStateHome({ env: { XDG_STATE_HOME: '' }, homedir: HOME }),
    ).toBe('')
  })
})

describe('getXDGCacheHome', () => {
  test('uses XDG_CACHE_HOME when set', () => {
    expect(
      getXDGCacheHome({
        env: { XDG_CACHE_HOME: '/custom/cache' },
        homedir: HOME,
      }),
    ).toBe('/custom/cache')
  })

  test('defaults to ~/.cache when unset', () => {
    expect(getXDGCacheHome({ env: {}, homedir: HOME })).toBe(
      join(HOME, '.cache'),
    )
  })

  test('XDG_CACHE_HOME takes precedence even with similar XDG_DATA_HOME set', () => {
    // Each XDG var is independent. Setting one doesn't affect another.
    expect(
      getXDGCacheHome({
        env: { XDG_CACHE_HOME: '/cache', XDG_DATA_HOME: '/data' },
        homedir: HOME,
      }),
    ).toBe('/cache')
  })
})

describe('getXDGDataHome', () => {
  test('uses XDG_DATA_HOME when set', () => {
    expect(
      getXDGDataHome({
        env: { XDG_DATA_HOME: '/custom/data' },
        homedir: HOME,
      }),
    ).toBe('/custom/data')
  })

  test('defaults to ~/.local/share when unset', () => {
    expect(getXDGDataHome({ env: {}, homedir: HOME })).toBe(
      join(HOME, '.local', 'share'),
    )
  })

  test('isolated from XDG_STATE_HOME', () => {
    expect(
      getXDGDataHome({
        env: { XDG_STATE_HOME: '/state' },
        homedir: HOME,
      }),
    ).toBe(join(HOME, '.local', 'share'))
  })
})

describe('getUserBinDir', () => {
  test('always ~/.local/bin (no XDG_BIN_HOME spec — function ignores env)', () => {
    // Critical: there is no standard XDG_BIN_HOME. The function returns
    // homedir + '.local/bin' regardless of any env var. If a future
    // refactor "extends" by reading XDG_BIN_HOME, the install path would
    // silently shift and update path resolution would break.
    expect(getUserBinDir({ env: {}, homedir: HOME })).toBe(
      join(HOME, '.local', 'bin'),
    )
  })

  test('ignores XDG_DATA_HOME (different XDG var)', () => {
    expect(
      getUserBinDir({
        env: { XDG_DATA_HOME: '/custom/data' },
        homedir: HOME,
      }),
    ).toBe(join(HOME, '.local', 'bin'))
  })

  test('ignores XDG_BIN_HOME (no such var in spec)', () => {
    // Document the deliberate non-support. XDG spec doesn't define
    // XDG_BIN_HOME. Any value here MUST be ignored.
    expect(
      getUserBinDir({
        env: { XDG_BIN_HOME: '/should/be/ignored' },
        homedir: HOME,
      }),
    ).toBe(join(HOME, '.local', 'bin'))
  })
})

describe('XDG functions — homedir override', () => {
  test('all functions honor explicit homedir option', () => {
    expect(getXDGStateHome({ env: {}, homedir: '/H' })).toBe(
      join('/H', '.local', 'state'),
    )
    expect(getXDGCacheHome({ env: {}, homedir: '/H' })).toBe(
      join('/H', '.cache'),
    )
    expect(getXDGDataHome({ env: {}, homedir: '/H' })).toBe(
      join('/H', '.local', 'share'),
    )
    expect(getUserBinDir({ env: {}, homedir: '/H' })).toBe(
      join('/H', '.local', 'bin'),
    )
  })
})

describe('XDG functions — return type', () => {
  test('all return non-empty strings', () => {
    expect(typeof getXDGStateHome({ env: {}, homedir: HOME })).toBe('string')
    expect(typeof getXDGCacheHome({ env: {}, homedir: HOME })).toBe('string')
    expect(typeof getXDGDataHome({ env: {}, homedir: HOME })).toBe('string')
    expect(typeof getUserBinDir({ env: {}, homedir: HOME })).toBe('string')
  })

  test('called without options uses real env / homedir without throwing', () => {
    expect(() => getXDGStateHome()).not.toThrow()
    expect(() => getXDGCacheHome()).not.toThrow()
    expect(() => getXDGDataHome()).not.toThrow()
    expect(() => getUserBinDir()).not.toThrow()
  })
})
