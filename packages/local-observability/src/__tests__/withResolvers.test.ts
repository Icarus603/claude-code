import { describe, expect, test } from 'bun:test'
import { withResolvers } from '../utils/withResolvers.js'

describe('withResolvers — basic shape', () => {
  test('returns an object with promise + resolve + reject fields', () => {
    const w = withResolvers<number>()
    expect(w).toHaveProperty('promise')
    expect(w).toHaveProperty('resolve')
    expect(w).toHaveProperty('reject')
    expect(w.promise).toBeInstanceOf(Promise)
    expect(typeof w.resolve).toBe('function')
    expect(typeof w.reject).toBe('function')
  })

  test('returns a fresh object on each call', () => {
    const a = withResolvers<number>()
    const b = withResolvers<number>()
    expect(a).not.toBe(b)
    expect(a.promise).not.toBe(b.promise)
    expect(a.resolve).not.toBe(b.resolve)
    expect(a.reject).not.toBe(b.reject)
  })
})

describe('withResolvers — resolve path', () => {
  test('resolve(value) settles the promise to value', async () => {
    const { promise, resolve } = withResolvers<string>()
    resolve('hello')
    await expect(promise).resolves.toBe('hello')
  })

  test('resolve(promise) chains correctly', async () => {
    const { promise, resolve } = withResolvers<number>()
    resolve(Promise.resolve(42))
    await expect(promise).resolves.toBe(42)
  })

  test('resolving with undefined works', async () => {
    const { promise, resolve } = withResolvers<undefined>()
    resolve(undefined)
    await expect(promise).resolves.toBeUndefined()
  })

  test('resolving with null works', async () => {
    const { promise, resolve } = withResolvers<null>()
    resolve(null)
    await expect(promise).resolves.toBeNull()
  })
})

describe('withResolvers — reject path', () => {
  test('reject(error) rejects the promise', async () => {
    const { promise, reject } = withResolvers<number>()
    const err = new Error('boom')
    reject(err)
    await expect(promise).rejects.toBe(err)
  })

  test('reject with non-Error reason still rejects', async () => {
    const { promise, reject } = withResolvers<number>()
    reject('plain-string')
    await expect(promise).rejects.toBe('plain-string')
  })

  test('reject with no argument rejects with undefined', async () => {
    const { promise, reject } = withResolvers<number>()
    reject()
    await expect(promise).rejects.toBeUndefined()
  })
})

describe('withResolvers — settlement is one-way', () => {
  test('resolve then reject — promise stays resolved (Promise spec)', async () => {
    const { promise, resolve, reject } = withResolvers<number>()
    resolve(1)
    reject(new Error('too-late'))
    // Promise is already settled; the reject is a no-op.
    await expect(promise).resolves.toBe(1)
  })

  test('reject then resolve — promise stays rejected (Promise spec)', async () => {
    const { promise, resolve, reject } = withResolvers<number>()
    reject(new Error('first'))
    resolve(99)
    // Already-rejected promise; resolve is a no-op.
    await expect(promise).rejects.toThrow('first')
  })

  test('multiple resolves are no-op after the first', async () => {
    const { promise, resolve } = withResolvers<number>()
    resolve(1)
    resolve(2)
    resolve(3)
    await expect(promise).resolves.toBe(1)
  })
})

describe('withResolvers — async coordination pattern', () => {
  // The whole point of this helper is to let one piece of code
  // create the promise + handle, and another piece of code settle
  // it later (e.g., in an event listener). Verify that pattern.

  test('handles cross-async settlement', async () => {
    const { promise, resolve } = withResolvers<string>()
    setTimeout(() => resolve('async-result'), 0)
    expect(await promise).toBe('async-result')
  })

  test('promise is awaitable before resolution', async () => {
    const { promise, resolve } = withResolvers<number>()
    const settled: { value?: number } = {}
    const awaitTask = promise.then(v => {
      settled.value = v
    })
    expect(settled.value).toBeUndefined() // not yet
    resolve(7)
    await awaitTask
    expect(settled.value).toBe(7)
  })

  test('multiple awaiters on the same promise all settle', async () => {
    const { promise, resolve } = withResolvers<number>()
    const a = promise.then(v => `a-${v}`)
    const b = promise.then(v => `b-${v}`)
    resolve(42)
    expect(await a).toBe('a-42')
    expect(await b).toBe('b-42')
  })
})
