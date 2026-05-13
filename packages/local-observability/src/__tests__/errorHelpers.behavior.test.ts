import { describe, expect, test } from 'bun:test'

import {
  errorMessage,
  getErrnoCode,
  getErrnoPath,
  isAbortError,
  isENOENT,
  isFsInaccessible,
  shortErrorStack,
  toError,
} from '../errorHelpers.ts'

/**
 * Pin error-helper invariants. These are called from catch blocks
 * throughout the codebase; a regression here changes how errors get
 * surfaced, logged, and matched against expected conditions.
 */
describe('errorHelpers', () => {
  describe('toError / errorMessage', () => {
    test('Error instance preserved as-is', () => {
      const e = new Error('boom')
      expect(toError(e)).toBe(e)
      expect(errorMessage(e)).toBe('boom')
    })

    test('string converted to Error via String()', () => {
      expect(toError('plain string').message).toBe('plain string')
      expect(errorMessage('plain string')).toBe('plain string')
    })

    test('object converted via String()', () => {
      // Pin: object becomes "[object Object]" via String() — not JSON.
      // A "let's JSON.stringify here" refactor would change debug logs.
      expect(errorMessage({})).toBe('[object Object]')
    })

    test('null/undefined converted to strings (no crash)', () => {
      expect(errorMessage(null)).toBe('null')
      expect(errorMessage(undefined)).toBe('undefined')
    })
  })

  describe('getErrnoCode / isENOENT', () => {
    test('Error with string `code` field returns code', () => {
      const e = Object.assign(new Error('not found'), { code: 'ENOENT' })
      expect(getErrnoCode(e)).toBe('ENOENT')
      expect(isENOENT(e)).toBe(true)
    })

    test('non-string code → undefined (defensive)', () => {
      const e = Object.assign(new Error('weird'), { code: 42 })
      expect(getErrnoCode(e)).toBeUndefined()
    })

    test('Error without `code` field → undefined', () => {
      expect(getErrnoCode(new Error('plain'))).toBeUndefined()
      expect(isENOENT(new Error('plain'))).toBe(false)
    })

    test('non-Error inputs → undefined / false', () => {
      expect(getErrnoCode(null)).toBeUndefined()
      expect(getErrnoCode('string')).toBeUndefined()
      expect(isENOENT(null)).toBe(false)
    })

    test('EACCES not flagged as ENOENT (exact match only)', () => {
      const e = Object.assign(new Error('denied'), { code: 'EACCES' })
      expect(isENOENT(e)).toBe(false)
      expect(getErrnoCode(e)).toBe('EACCES')
    })
  })

  describe('getErrnoPath', () => {
    test('Error with string `path` returns path', () => {
      const e = Object.assign(new Error('x'), { path: '/etc/passwd' })
      expect(getErrnoPath(e)).toBe('/etc/passwd')
    })

    test('no path → undefined', () => {
      expect(getErrnoPath(new Error('x'))).toBeUndefined()
    })
  })

  describe('isAbortError', () => {
    test('AbortError class → true', () => {
      class AbortError extends Error {
        override name = 'AbortError'
      }
      expect(isAbortError(new AbortError())).toBe(true)
    })

    test('DOMException with name "AbortError" → true', () => {
      // Native fetch abort throws this shape.
      const e = Object.assign(new Error('aborted'), { name: 'AbortError' })
      expect(isAbortError(e)).toBe(true)
    })

    test('regular Error → false', () => {
      expect(isAbortError(new Error('plain'))).toBe(false)
    })
  })

  describe('isFsInaccessible', () => {
    test('ENOENT → true (path missing)', () => {
      expect(isFsInaccessible(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(
        true,
      )
    })

    test('EACCES → true (permission denied — counts as inaccessible)', () => {
      // User can't see the file even though it might exist. Treat as missing.
      expect(isFsInaccessible(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(
        true,
      )
    })

    test('regular Error → false', () => {
      expect(isFsInaccessible(new Error('plain'))).toBe(false)
    })
  })

  describe('shortErrorStack', () => {
    test('non-Error → String() coerce', () => {
      expect(shortErrorStack('plain')).toBe('plain')
    })

    test('Error without stack → just the message', () => {
      const e = new Error('boom')
      ;(e as any).stack = undefined
      expect(shortErrorStack(e)).toBe('boom')
    })

    test('limits to N stack frames (default 5)', () => {
      const e = new Error('boom')
      // Synthesize a stack with 10 frames
      const frames = Array.from({ length: 10 }, (_, i) => `    at fn${i} (file.ts:${i})`)
      e.stack = `Error: boom\n${frames.join('\n')}`
      const result = shortErrorStack(e, 3)
      const resultLines = result.split('\n')
      // Header + 3 frames = 4 lines
      expect(resultLines.length).toBe(4)
    })
  })
})
