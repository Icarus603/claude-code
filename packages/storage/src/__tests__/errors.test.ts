import { describe, expect, test } from 'bun:test'
import {
  BackendError,
  ConflictError,
  NotFoundError,
  StorageBaseError,
} from '../errors.js'

describe('StorageBaseError', () => {
  test('stores code + message + name', () => {
    const e = new StorageBaseError('STORAGE_TEST', 'whoops')
    expect(e.code).toBe('STORAGE_TEST')
    expect(e.message).toBe('whoops')
    expect(e.name).toBe('StorageBaseError')
  })
  test('preserves options.cause', () => {
    const cause = new Error('underlying disk error')
    const e = new StorageBaseError('STORAGE_X', 'wrap', { cause })
    expect(e.cause).toBe(cause)
  })
  test('is an Error subclass', () => {
    expect(new StorageBaseError('STORAGE_X', 'x')).toBeInstanceOf(Error)
  })
})

describe('subclass error codes', () => {
  test('NotFoundError', () => {
    const e = new NotFoundError('session id missing')
    expect(e.code).toBe('STORAGE_NOT_FOUND')
    expect(e.name).toBe('StorageNotFoundError')
    expect(e).toBeInstanceOf(StorageBaseError)
  })
  test('ConflictError', () => {
    const e = new ConflictError('parent uuid mismatch')
    expect(e.code).toBe('STORAGE_CONFLICT')
    expect(e.name).toBe('StorageConflictError')
  })
  test('BackendError', () => {
    const e = new BackendError('disk full')
    expect(e.code).toBe('STORAGE_BACKEND_ERROR')
    expect(e.name).toBe('StorageBackendError')
  })
})

describe('error-code namespace invariants', () => {
  test('all subclass codes prefixed STORAGE_', () => {
    const codes = [
      new NotFoundError('x').code,
      new ConflictError('x').code,
      new BackendError('x').code,
    ]
    for (const c of codes) {
      expect(c.startsWith('STORAGE_')).toBe(true)
    }
  })
  test('subclass codes are unique (regression check)', () => {
    const codes = [
      new NotFoundError('x').code,
      new ConflictError('x').code,
      new BackendError('x').code,
    ]
    expect(new Set(codes).size).toBe(codes.length)
  })
})
