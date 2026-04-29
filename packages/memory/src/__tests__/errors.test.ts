import { describe, expect, test } from 'bun:test'
import {
  HostBindingsError,
  MemoryBaseError,
  MemoryPathError,
  MemoryReadError,
  MemoryWriteError,
  PathTraversalError,
} from '../errors.js'

describe('MemoryBaseError', () => {
  test('stores code + message + name', () => {
    const e = new MemoryBaseError('MEM_TEST', 'whoops')
    expect(e.code).toBe('MEM_TEST')
    expect(e.message).toBe('whoops')
    expect(e.name).toBe('MemoryBaseError')
  })
  test('preserves options.cause', () => {
    const cause = new Error('underlying')
    const e = new MemoryBaseError('MEM_X', 'wrap', { cause })
    expect(e.cause).toBe(cause)
  })
})

describe('subclasses have stable error codes', () => {
  test('MemoryReadError', () => {
    const e = new MemoryReadError('boom')
    expect(e.code).toBe('MEMORY_READ_ERROR')
    expect(e.name).toBe('MemoryReadError')
    expect(e).toBeInstanceOf(MemoryBaseError)
  })
  test('MemoryWriteError', () => {
    const e = new MemoryWriteError('boom')
    expect(e.code).toBe('MEMORY_WRITE_ERROR')
    expect(e.name).toBe('MemoryWriteError')
  })
  test('MemoryPathError', () => {
    const e = new MemoryPathError('boom')
    expect(e.code).toBe('MEMORY_PATH_ERROR')
    expect(e.name).toBe('MemoryPathError')
  })
  test('HostBindingsError', () => {
    const e = new HostBindingsError('not bound')
    expect(e.code).toBe('MEMORY_HOST_BINDINGS_ERROR')
    expect(e.name).toBe('MemoryHostBindingsError')
  })
  test('PathTraversalError', () => {
    const e = new PathTraversalError('traversal')
    expect(e.code).toBe('MEMORY_PATH_TRAVERSAL')
    expect(e.name).toBe('MemoryPathTraversalError')
  })
})

describe('error-code namespace invariants', () => {
  test('all subclass codes prefixed MEMORY_', () => {
    const codes = [
      new MemoryReadError('x').code,
      new MemoryWriteError('x').code,
      new MemoryPathError('x').code,
      new HostBindingsError('x').code,
      new PathTraversalError('x').code,
    ]
    for (const c of codes) {
      expect(c.startsWith('MEMORY_')).toBe(true)
    }
  })
  test('subclass codes are unique', () => {
    const codes = [
      new MemoryReadError('x').code,
      new MemoryWriteError('x').code,
      new MemoryPathError('x').code,
      new HostBindingsError('x').code,
      new PathTraversalError('x').code,
    ]
    expect(new Set(codes).size).toBe(codes.length)
  })
})
