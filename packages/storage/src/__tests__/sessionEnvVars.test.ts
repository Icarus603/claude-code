import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearSessionEnvVars,
  deleteSessionEnvVar,
  getSessionEnvVars,
  setSessionEnvVar,
} from '../sessionEnvVars.js'

afterEach(() => {
  clearSessionEnvVars()
})

describe('setSessionEnvVar / getSessionEnvVars', () => {
  test('starts empty', () => {
    expect(getSessionEnvVars().size).toBe(0)
  })

  test('a set value is retrievable', () => {
    setSessionEnvVar('FOO', 'bar')
    const map = getSessionEnvVars()
    expect(map.get('FOO')).toBe('bar')
    expect(map.size).toBe(1)
  })

  test('setting the same key twice overwrites', () => {
    setSessionEnvVar('FOO', 'bar')
    setSessionEnvVar('FOO', 'baz')
    expect(getSessionEnvVars().get('FOO')).toBe('baz')
    expect(getSessionEnvVars().size).toBe(1)
  })

  test('multiple distinct keys are stored independently', () => {
    setSessionEnvVar('A', '1')
    setSessionEnvVar('B', '2')
    setSessionEnvVar('C', '3')
    const map = getSessionEnvVars()
    expect(map.size).toBe(3)
    expect(map.get('A')).toBe('1')
    expect(map.get('B')).toBe('2')
    expect(map.get('C')).toBe('3')
  })

  test('values can be empty strings (distinct from delete)', () => {
    // Contract: empty string is a valid value. Setting "VAR=" should
    // produce a present-but-empty entry, NOT delete the key.
    setSessionEnvVar('EMPTY', '')
    const map = getSessionEnvVars()
    expect(map.has('EMPTY')).toBe(true)
    expect(map.get('EMPTY')).toBe('')
  })

  test('keys with special characters are stored verbatim', () => {
    setSessionEnvVar('FOO_BAR', 'v1')
    setSessionEnvVar('foo.bar', 'v2')
    setSessionEnvVar('123', 'v3')
    const map = getSessionEnvVars()
    expect(map.get('FOO_BAR')).toBe('v1')
    expect(map.get('foo.bar')).toBe('v2')
    expect(map.get('123')).toBe('v3')
  })
})

describe('getSessionEnvVars — return type contract', () => {
  test('returns ReadonlyMap (cannot mutate via the returned reference)', () => {
    setSessionEnvVar('FOO', 'bar')
    const map = getSessionEnvVars()
    // ReadonlyMap is a TS type only — at runtime it's the real Map.
    // The contract is that the function ONLY exposes Read methods.
    // We can't enforce this at runtime, but we can verify the basic
    // shape is what callers expect.
    expect(map.get('FOO')).toBe('bar')
    expect(typeof map.has).toBe('function')
    expect(typeof map.size).toBe('number')
  })

  test('returned reference reflects later mutations (it is the same Map)', () => {
    // Important contract: getSessionEnvVars() does NOT clone. Callers
    // get a live reference. If a future "defensive copy" change is
    // made, this test fires and prompts a thoughtful review of all
    // call sites that iterate the map asynchronously.
    const map1 = getSessionEnvVars()
    setSessionEnvVar('FOO', 'bar')
    expect(map1.get('FOO')).toBe('bar')
  })
})

describe('deleteSessionEnvVar', () => {
  test('removes an existing entry', () => {
    setSessionEnvVar('FOO', 'bar')
    deleteSessionEnvVar('FOO')
    expect(getSessionEnvVars().has('FOO')).toBe(false)
  })

  test('deleting a non-existent key is a no-op', () => {
    setSessionEnvVar('FOO', 'bar')
    deleteSessionEnvVar('DOES_NOT_EXIST')
    expect(getSessionEnvVars().get('FOO')).toBe('bar')
    expect(getSessionEnvVars().size).toBe(1)
  })

  test('only deletes the named key, not others', () => {
    setSessionEnvVar('A', '1')
    setSessionEnvVar('B', '2')
    deleteSessionEnvVar('A')
    expect(getSessionEnvVars().has('A')).toBe(false)
    expect(getSessionEnvVars().get('B')).toBe('2')
  })
})

describe('clearSessionEnvVars', () => {
  test('removes all entries', () => {
    setSessionEnvVar('A', '1')
    setSessionEnvVar('B', '2')
    setSessionEnvVar('C', '3')
    clearSessionEnvVars()
    expect(getSessionEnvVars().size).toBe(0)
  })

  test('clearing an empty map is a no-op', () => {
    clearSessionEnvVars()
    expect(getSessionEnvVars().size).toBe(0)
  })
})
