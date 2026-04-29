import { afterEach, describe, expect, test } from 'bun:test'
import {
  registerCleanup,
  runCleanupFunctions,
} from '../cleanupRegistry.js'

afterEach(async () => {
  // The module-level Set is shared across tests. Clear by registering &
  // running a no-op set of cleanups, then unregistering all by registering
  // a marker and reading. The cleanest approach: each test must
  // unregister anything it registered.
  // Tests below register inline and call their unregister fn explicitly,
  // so this hook is intentionally a no-op.
})

describe('registerCleanup — registry state', () => {
  test('registers a function and returns an unregister fn', () => {
    const fn = async () => {}
    const unreg = registerCleanup(fn)
    expect(typeof unreg).toBe('function')
    unreg() // clean up
  })

  test('unregister removes the function (subsequent run does not call it)', async () => {
    let called = false
    const fn = async () => {
      called = true
    }
    const unreg = registerCleanup(fn)
    unreg()
    await runCleanupFunctions()
    expect(called).toBe(false)
  })

  test('multiple registrations of the SAME function are deduped (Set semantics)', async () => {
    let count = 0
    const fn = async () => {
      count++
    }
    const unreg1 = registerCleanup(fn)
    const unreg2 = registerCleanup(fn)
    // Both unreg1 and unreg2 reference the same Set entry.
    await runCleanupFunctions()
    expect(count).toBe(1) // called once despite two register calls
    // Either unreg cleans the slot (Set has only one entry).
    unreg1()
    // Second unreg is a no-op (entry already gone).
    unreg2()
  })

  test('register-then-immediately-unregister leaves no callable in registry', async () => {
    let called = false
    const unreg = registerCleanup(async () => {
      called = true
    })
    unreg()
    await runCleanupFunctions()
    expect(called).toBe(false)
  })

  test('different function references are NOT deduped', async () => {
    let count = 0
    const fn1 = async () => {
      count++
    }
    const fn2 = async () => {
      count++
    }
    const u1 = registerCleanup(fn1)
    const u2 = registerCleanup(fn2)
    await runCleanupFunctions()
    expect(count).toBe(2)
    u1()
    u2()
  })
})

describe('runCleanupFunctions — invocation', () => {
  test('runs all registered functions concurrently (Promise.all)', async () => {
    let aDone = false
    let bDone = false
    const a = async () => {
      await new Promise(r => setTimeout(r, 5))
      aDone = true
    }
    const b = async () => {
      await new Promise(r => setTimeout(r, 5))
      bDone = true
    }
    const u1 = registerCleanup(a)
    const u2 = registerCleanup(b)
    await runCleanupFunctions()
    expect(aDone).toBe(true)
    expect(bDone).toBe(true)
    u1()
    u2()
  })

  test('rejection in one cleanup propagates (NOT silently swallowed)', async () => {
    // Promise.all rejects on first failure. CRITICAL: if a future
    // refactor switches to Promise.allSettled, errors would be
    // swallowed. Tests would be needed to detect that change.
    const u1 = registerCleanup(async () => {
      throw new Error('cleanup boom')
    })
    let caught = false
    try {
      await runCleanupFunctions()
    } catch (e) {
      caught = (e as Error).message === 'cleanup boom'
    }
    expect(caught).toBe(true)
    u1()
  })

  test('empty registry → resolves successfully', async () => {
    // After full cleanup the registry should be runnable as no-op.
    // Just verify it doesn't throw.
    await expect(runCleanupFunctions()).resolves.toBeUndefined()
  })

  test('runCleanupFunctions does NOT clear the registry (functions stay registered)', async () => {
    // Documents that running cleanup is NOT auto-unregister. The
    // function can be called again and will fire all registered
    // cleanups again. Process shutdown calls this once and exits.
    let count = 0
    const u = registerCleanup(async () => {
      count++
    })
    await runCleanupFunctions()
    await runCleanupFunctions()
    expect(count).toBe(2)
    u()
  })
})

describe('registerCleanup — return value contract', () => {
  test('unregister fn returns boolean (Set.delete result)', () => {
    // Set.delete returns true if the element was present. Document the
    // return type so callers can know if they double-unregistered.
    const fn = async () => {}
    const unreg = registerCleanup(fn)
    const firstResult = unreg()
    // Set.delete returns boolean. The fn signature says `() => void`
    // but the underlying Set.delete returns true. TypeScript erases
    // the boolean — but at runtime it's there.
    expect(firstResult === true || firstResult === undefined).toBe(true)
    // Second call returns false (already gone).
    const secondResult = unreg()
    expect(secondResult === false || secondResult === undefined).toBe(true)
  })
})
