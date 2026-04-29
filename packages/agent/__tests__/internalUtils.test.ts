import { describe, expect, test } from 'bun:test'
import {
  asSystemPrompt,
  count,
  errorMessage,
  getErrnoCode,
  isENOENT,
  isEnvDefinedFalsy,
  isEnvTruthy,
  isFsInaccessible,
  jsonStringify,
  lazySchema,
  safeParseJSON,
} from '../internalUtils.js'

describe('errorMessage', () => {
  test('returns Error.message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })
  test('returns String(value) for non-Error', () => {
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(null)).toBe('null')
    expect(errorMessage(undefined)).toBe('undefined')
  })
  test('handles object without message', () => {
    expect(errorMessage({ foo: 'bar' })).toBe('[object Object]')
  })
})

describe('getErrnoCode', () => {
  test('extracts code from errno-shaped error', () => {
    const e = Object.assign(new Error('not found'), { code: 'ENOENT' })
    expect(getErrnoCode(e)).toBe('ENOENT')
  })
  test('returns undefined when code absent', () => {
    expect(getErrnoCode(new Error('plain'))).toBeUndefined()
    expect(getErrnoCode({})).toBeUndefined()
    expect(getErrnoCode(null)).toBeUndefined()
    expect(getErrnoCode('string')).toBeUndefined()
  })
  test('returns undefined when code is not a string', () => {
    expect(getErrnoCode({ code: 123 })).toBeUndefined()
    expect(getErrnoCode({ code: null })).toBeUndefined()
  })
})

describe('isENOENT / isFsInaccessible', () => {
  test('isENOENT matches only ENOENT', () => {
    expect(isENOENT({ code: 'ENOENT' })).toBe(true)
    expect(isENOENT({ code: 'EACCES' })).toBe(false)
    expect(isENOENT(new Error('plain'))).toBe(false)
  })
  test('isFsInaccessible matches inaccessibility errors', () => {
    expect(isFsInaccessible({ code: 'ENOENT' })).toBe(true)
    expect(isFsInaccessible({ code: 'EACCES' })).toBe(true)
    expect(isFsInaccessible({ code: 'EPERM' })).toBe(true)
    expect(isFsInaccessible({ code: 'ENOTDIR' })).toBe(true)
    expect(isFsInaccessible({ code: 'ELOOP' })).toBe(true)
  })
  test('isFsInaccessible does NOT match unrelated errno', () => {
    expect(isFsInaccessible({ code: 'EISDIR' })).toBe(false)
    expect(isFsInaccessible({ code: 'EBUSY' })).toBe(false)
    expect(isFsInaccessible(new Error('plain'))).toBe(false)
  })
})

describe('isEnvTruthy', () => {
  test('canonical truthy values', () => {
    expect(isEnvTruthy('1')).toBe(true)
    expect(isEnvTruthy('true')).toBe(true)
    expect(isEnvTruthy('yes')).toBe(true)
    expect(isEnvTruthy('on')).toBe(true)
  })
  test('case-insensitive + whitespace tolerant', () => {
    expect(isEnvTruthy('  TRUE  ')).toBe(true)
    expect(isEnvTruthy('YES')).toBe(true)
    expect(isEnvTruthy('On')).toBe(true)
  })
  test('boolean true → true', () => {
    expect(isEnvTruthy(true)).toBe(true)
  })
  test('falsy / undefined / unrecognized → false', () => {
    expect(isEnvTruthy('0')).toBe(false)
    expect(isEnvTruthy('false')).toBe(false)
    expect(isEnvTruthy('')).toBe(false)
    expect(isEnvTruthy(undefined)).toBe(false)
    expect(isEnvTruthy('garbage')).toBe(false)
    expect(isEnvTruthy(false)).toBe(false)
  })
})

describe('isEnvDefinedFalsy', () => {
  test('canonical falsy values when defined', () => {
    expect(isEnvDefinedFalsy('0')).toBe(true)
    expect(isEnvDefinedFalsy('false')).toBe(true)
    expect(isEnvDefinedFalsy('no')).toBe(true)
    expect(isEnvDefinedFalsy('off')).toBe(true)
  })
  test('case-insensitive + whitespace tolerant', () => {
    expect(isEnvDefinedFalsy('  FALSE  ')).toBe(true)
    expect(isEnvDefinedFalsy('NO')).toBe(true)
  })
  test('boolean false → true', () => {
    expect(isEnvDefinedFalsy(false)).toBe(true)
  })
  test('undefined → false (NOT defined)', () => {
    expect(isEnvDefinedFalsy(undefined)).toBe(false)
  })
  test('truthy values → false', () => {
    expect(isEnvDefinedFalsy('1')).toBe(false)
    expect(isEnvDefinedFalsy('true')).toBe(false)
    expect(isEnvDefinedFalsy(true)).toBe(false)
  })
  test('empty string → false (not "defined falsy")', () => {
    expect(isEnvDefinedFalsy('')).toBe(false)
  })
})

describe('safeParseJSON', () => {
  test('parses valid JSON', () => {
    expect(safeParseJSON('{"a":1}')).toEqual({ a: 1 })
    expect(safeParseJSON('[1,2,3]')).toEqual([1, 2, 3])
    expect(safeParseJSON('42')).toBe(42)
  })
  test('returns null for null/undefined/empty', () => {
    expect(safeParseJSON(null)).toBeNull()
    expect(safeParseJSON(undefined)).toBeNull()
    expect(safeParseJSON('')).toBeNull()
  })
  test('returns null for malformed JSON (never throws)', () => {
    expect(safeParseJSON('{not json}')).toBeNull()
    expect(safeParseJSON('}{')).toBeNull()
  })
})

describe('jsonStringify', () => {
  test('matches JSON.stringify behavior', () => {
    expect(jsonStringify({ a: 1 })).toBe('{"a":1}')
  })
  test('passes replacer through', () => {
    const replacer = (_: string, v: unknown) =>
      typeof v === 'number' ? v * 2 : v
    expect(jsonStringify({ a: 1 }, replacer)).toBe('{"a":2}')
  })
  test('passes space through', () => {
    expect(jsonStringify({ a: 1 }, null, 2)).toBe('{\n  "a": 1\n}')
  })
})

describe('lazySchema', () => {
  test('factory called once', () => {
    let calls = 0
    const lazy = lazySchema(() => {
      calls++
      return { value: 42 }
    })
    expect(calls).toBe(0)
    lazy()
    lazy()
    lazy()
    expect(calls).toBe(1)
  })
  test('returns same instance', () => {
    const lazy = lazySchema(() => ({}))
    expect(lazy()).toBe(lazy())
  })
})

describe('count', () => {
  test('returns matching count', () => {
    expect(count([1, 2, 3, 4], n => n > 2)).toBe(2)
  })
  test('returns 0 when none match', () => {
    expect(count([1, 2, 3], n => n > 10)).toBe(0)
  })
  test('returns full length when all match', () => {
    expect(count([1, 2, 3], n => n > 0)).toBe(3)
  })
  test('handles empty array', () => {
    expect(count([], () => true)).toBe(0)
  })
})

describe('asSystemPrompt', () => {
  test('returns the input array (branded cast)', () => {
    const input: readonly string[] = ['a', 'b', 'c']
    expect(asSystemPrompt(input)).toBe(input as never)
  })
  test('preserves array contents', () => {
    expect([...asSystemPrompt(['x', 'y'])]).toEqual(['x', 'y'])
  })
})
