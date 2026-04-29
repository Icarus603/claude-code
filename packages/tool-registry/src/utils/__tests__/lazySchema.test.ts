import { describe, expect, mock, test } from 'bun:test'
import { lazySchema } from '../lazySchema.js'

describe('lazySchema', () => {
  test('factory is NOT called on lazySchema construction', () => {
    const factory = mock(() => ({ value: 42 }))
    lazySchema(factory)
    expect(factory).not.toHaveBeenCalled()
  })

  test('factory is called on first invocation', () => {
    const factory = mock(() => ({ value: 42 }))
    const get = lazySchema(factory)
    get()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  test('factory is called only ONCE across many invocations', () => {
    const factory = mock(() => ({ value: 42 }))
    const get = lazySchema(factory)
    get()
    get()
    get()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  test('repeated calls return the same reference (memoization)', () => {
    const get = lazySchema(() => ({ value: 42 }))
    const a = get()
    const b = get()
    expect(a).toBe(b)
  })

  test('returns the factory output unchanged', () => {
    const get = lazySchema(() => 'hello')
    expect(get()).toBe('hello')
  })

  test('handles primitive values (number, boolean)', () => {
    expect(lazySchema(() => 42)()).toBe(42)
    expect(lazySchema(() => true)()).toBe(true)
  })

  test('handles undefined return value (uses cached || factory pattern with ??=)', () => {
    // Critical: `cached ??= factory()` only re-invokes when cached is
    // null/undefined. So if factory returns undefined, the next call
    // RE-INVOKES factory. Documents this quirk.
    const factory = mock(() => undefined)
    const get = lazySchema(factory)
    get()
    get()
    get()
    // Each call sees `cached === undefined` → re-invokes factory.
    expect(factory).toHaveBeenCalledTimes(3)
  })

  test('handles null return value (same ??= quirk applies)', () => {
    const factory = mock(() => null)
    const get = lazySchema(factory)
    get()
    get()
    expect(factory).toHaveBeenCalledTimes(2)
  })

  test('handles falsy non-nullish values (0, "", false) — caches correctly', () => {
    // `??=` only re-invokes on null/undefined. 0 / '' / false should
    // be cached on first call.
    const factory0 = mock(() => 0)
    const get0 = lazySchema(factory0)
    get0()
    get0()
    expect(factory0).toHaveBeenCalledTimes(1)

    const factoryEmpty = mock(() => '')
    const getEmpty = lazySchema(factoryEmpty)
    getEmpty()
    getEmpty()
    expect(factoryEmpty).toHaveBeenCalledTimes(1)

    const factoryFalse = mock(() => false)
    const getFalse = lazySchema(factoryFalse)
    getFalse()
    getFalse()
    expect(factoryFalse).toHaveBeenCalledTimes(1)
  })

  test('factory exception propagates and does NOT cache', () => {
    let attempts = 0
    const factory = () => {
      attempts++
      throw new Error('factory-failed')
    }
    const get = lazySchema(factory)
    expect(() => get()).toThrow('factory-failed')
    // After exception, cached stays undefined → next call retries.
    expect(() => get()).toThrow('factory-failed')
    expect(attempts).toBe(2)
  })

  test('different lazySchema instances have independent caches', () => {
    const factory1 = mock(() => 'a')
    const factory2 = mock(() => 'b')
    const a = lazySchema(factory1)
    const b = lazySchema(factory2)
    expect(a()).toBe('a')
    expect(b()).toBe('b')
    expect(factory1).toHaveBeenCalledTimes(1)
    expect(factory2).toHaveBeenCalledTimes(1)
  })
})
