import { describe, expect, test } from 'bun:test'

import {
  AbortError,
  AskRequiredError,
  ContextError,
  DeniedError,
  HostBindingsError,
  PermissionBaseError,
} from '../errors.ts'

/**
 * Pin V7 §6.5 PermissionError namespace. The codes are checked by
 * callers (catch blocks across the codebase): a regression that changes
 * code strings or class hierarchy breaks every catch block silently.
 *
 * Invariants:
 *  1. All 5 subclasses extend PermissionBaseError (NOT Error directly).
 *  2. Code strings are exact:
 *     - DeniedError: PERMISSION_DENIED
 *     - AskRequiredError: PERMISSION_ASK_REQUIRED
 *     - ContextError: PERMISSION_CONTEXT_ERROR
 *     - AbortError: PERMISSION_ABORTED
 *     - HostBindingsError: PERMISSION_HOST_BINDINGS_ERROR
 *  3. Class .name property is the specific subclass name (NOT the parent).
 *  4. AbortError has a default message "Permission request aborted".
 *  5. ErrorOptions (cause) flows through to base Error.
 */
describe('permission errors namespace', () => {
  describe('PermissionBaseError (the trunk class)', () => {
    test('extends Error (preserves stack/Error semantics)', () => {
      const e = new PermissionBaseError('CODE', 'message')
      expect(e instanceof Error).toBe(true)
      expect(e instanceof PermissionBaseError).toBe(true)
    })

    test('exposes .code (readonly) and .message', () => {
      const e = new PermissionBaseError('CODE', 'message')
      expect(e.code).toBe('CODE')
      expect(e.message).toBe('message')
    })

    test('name === "PermissionBaseError"', () => {
      const e = new PermissionBaseError('CODE', 'message')
      expect(e.name).toBe('PermissionBaseError')
    })

    test('preserves cause via ErrorOptions', () => {
      const inner = new Error('inner')
      const e = new PermissionBaseError('CODE', 'outer', { cause: inner })
      expect(e.cause).toBe(inner)
    })
  })

  describe('DeniedError', () => {
    test('code = "PERMISSION_DENIED" (exact, caller-checked)', () => {
      // Pin: catch (e) { if (e.code === 'PERMISSION_DENIED') ... }
      const e = new DeniedError('user said no')
      expect(e.code).toBe('PERMISSION_DENIED')
    })

    test('extends PermissionBaseError (NOT raw Error)', () => {
      const e = new DeniedError('x')
      expect(e instanceof PermissionBaseError).toBe(true)
      expect(e instanceof DeniedError).toBe(true)
    })

    test('name = "PermissionDeniedError" (subclass name, NOT base)', () => {
      const e = new DeniedError('x')
      expect(e.name).toBe('PermissionDeniedError')
    })
  })

  describe('AskRequiredError', () => {
    test('code = "PERMISSION_ASK_REQUIRED"', () => {
      // Pin: caller toggles "show approval prompt" on this exact code.
      const e = new AskRequiredError('needs ask')
      expect(e.code).toBe('PERMISSION_ASK_REQUIRED')
    })

    test('name = "PermissionAskRequiredError"', () => {
      const e = new AskRequiredError('x')
      expect(e.name).toBe('PermissionAskRequiredError')
    })
  })

  describe('ContextError', () => {
    test('code = "PERMISSION_CONTEXT_ERROR"', () => {
      const e = new ContextError('bad context')
      expect(e.code).toBe('PERMISSION_CONTEXT_ERROR')
    })

    test('name = "PermissionContextError"', () => {
      const e = new ContextError('x')
      expect(e.name).toBe('PermissionContextError')
    })
  })

  describe('AbortError', () => {
    test('code = "PERMISSION_ABORTED"', () => {
      const e = new AbortError()
      expect(e.code).toBe('PERMISSION_ABORTED')
    })

    test('default message = "Permission request aborted"', () => {
      // Pin: the default — caller doesn't have to pass one. A regression
      // to empty default would lose informative error text.
      const e = new AbortError()
      expect(e.message).toBe('Permission request aborted')
    })

    test('explicit message overrides default', () => {
      const e = new AbortError('user pressed escape')
      expect(e.message).toBe('user pressed escape')
    })

    test('name = "PermissionAbortError"', () => {
      const e = new AbortError()
      expect(e.name).toBe('PermissionAbortError')
    })
  })

  describe('HostBindingsError', () => {
    test('code = "PERMISSION_HOST_BINDINGS_ERROR"', () => {
      const e = new HostBindingsError('bindings missing')
      expect(e.code).toBe('PERMISSION_HOST_BINDINGS_ERROR')
    })

    test('name = "PermissionHostBindingsError"', () => {
      const e = new HostBindingsError('x')
      expect(e.name).toBe('PermissionHostBindingsError')
    })
  })

  describe('Cross-class invariants', () => {
    test('All 5 subclasses are catchable via PermissionBaseError', () => {
      // Pin: structural — a single catch block can handle all kinds.
      const errors = [
        new DeniedError('x'),
        new AskRequiredError('x'),
        new ContextError('x'),
        new AbortError('x'),
        new HostBindingsError('x'),
      ]
      for (const e of errors) {
        expect(e instanceof PermissionBaseError).toBe(true)
      }
    })

    test('All codes are unique (no aliasing across subclasses)', () => {
      const codes = [
        new DeniedError('x').code,
        new AskRequiredError('x').code,
        new ContextError('x').code,
        new AbortError().code,
        new HostBindingsError('x').code,
      ]
      const unique = new Set(codes)
      expect(unique.size).toBe(codes.length)
    })

    test('All codes start with PERMISSION_ prefix (namespace marker)', () => {
      // Pin: cross-package error code search relies on this prefix.
      const codes = [
        new DeniedError('x').code,
        new AskRequiredError('x').code,
        new ContextError('x').code,
        new AbortError().code,
        new HostBindingsError('x').code,
      ]
      for (const c of codes) {
        expect(c.startsWith('PERMISSION_')).toBe(true)
      }
    })
  })
})
