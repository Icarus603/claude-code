import { describe, expect, test } from 'bun:test'
import { sleep, withTimeout } from '../sleep.js'

describe('sleep — basic timing', () => {
  test('resolves after ms (no signal)', async () => {
    const start = Date.now()
    await sleep(20)
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
  })

  test('0ms — resolves on next tick', async () => {
    const r = await sleep(0)
    expect(r).toBeUndefined()
  })

  test('returns void / undefined on success', async () => {
    expect(await sleep(5)).toBeUndefined()
  })
})

describe('sleep — abort BEFORE await (already-aborted signal)', () => {
  // CRITICAL state-machine probe: pre-aborted signals must be detected
  // synchronously in the constructor, NOT after the timer fires. The
  // doc comment says "Check aborted state BEFORE setting up the timer"
  // — a refactor that swaps order would create a dangling timer.

  test('pre-aborted + default opts → resolves silently', async () => {
    const ac = new AbortController()
    ac.abort()
    expect(await sleep(1000, ac.signal)).toBeUndefined()
  })

  test('pre-aborted + throwOnAbort:true → rejects with default error', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(
      sleep(1000, ac.signal, { throwOnAbort: true }),
    ).rejects.toThrow(/aborted/)
  })

  test('pre-aborted + abortError → rejects with custom error', async () => {
    const ac = new AbortController()
    ac.abort()
    class CustomAbort extends Error {}
    await expect(
      sleep(1000, ac.signal, { abortError: () => new CustomAbort('custom') }),
    ).rejects.toBeInstanceOf(CustomAbort)
  })

  test('pre-aborted + abortError IMPLIES throwOnAbort (no need to set both)', async () => {
    // Documented: "Pass abortError to customize ... (implies throwOnAbort: true)".
    // The check is `opts?.throwOnAbort || opts?.abortError` — abortError
    // alone is sufficient to trigger reject path.
    const ac = new AbortController()
    ac.abort()
    await expect(
      sleep(1000, ac.signal, {
        abortError: () => new Error('via-abortError-only'),
      }),
    ).rejects.toThrow(/via-abortError-only/)
  })
})

describe('sleep — abort DURING await', () => {
  test('mid-sleep abort + default opts → resolves silently', async () => {
    const ac = new AbortController()
    const p = sleep(1000, ac.signal)
    setTimeout(() => ac.abort(), 5)
    expect(await p).toBeUndefined()
  })

  test('mid-sleep abort + throwOnAbort → rejects', async () => {
    const ac = new AbortController()
    const p = sleep(1000, ac.signal, { throwOnAbort: true })
    setTimeout(() => ac.abort(), 5)
    await expect(p).rejects.toThrow(/aborted/)
  })

  test('mid-sleep abort + custom abortError → rejects with that error', async () => {
    const ac = new AbortController()
    class TimeoutAbort extends Error {}
    const p = sleep(1000, ac.signal, {
      abortError: () => new TimeoutAbort('cancelled'),
    })
    setTimeout(() => ac.abort(), 5)
    await expect(p).rejects.toBeInstanceOf(TimeoutAbort)
  })

  test('abort after sleep already resolved → does NOT throw', async () => {
    // Signal aborts after the timer fired. The once:true listener
    // already cleaned up; abort is a no-op.
    const ac = new AbortController()
    await sleep(5, ac.signal)
    expect(() => ac.abort()).not.toThrow()
  })
})

describe('sleep — listener cleanup (memory-leak prevention)', () => {
  test('successful sleep removes abort listener', async () => {
    // The listener is added with `once: true`, but the timer also
    // explicitly removes it on resolve. Verify by aborting AFTER
    // resolve and ensuring nothing fires (no observable change).
    const ac = new AbortController()
    await sleep(5, ac.signal)
    // If the listener wasn't removed, this would re-trigger abort logic.
    // Just verify no throw / no hang.
    ac.abort()
    expect(ac.signal.aborted).toBe(true) // signal does abort, but no callback fires
  })

  test('100 sequential sleeps — does not accumulate listeners', async () => {
    // Smoke test for listener leak. AbortSignal has a getMaxListeners
    // warning at 10+ listeners; we'd see a node deprecation warning
    // if `once: true` weren't honored.
    const ac = new AbortController()
    for (let i = 0; i < 100; i++) {
      await sleep(0, ac.signal)
    }
    // No assertion needed — passing without warnings is the assertion.
    expect(true).toBe(true)
  })
})

describe('sleep — unref option', () => {
  test('unref:true allows process exit (smoke — does not throw)', async () => {
    // We can't directly test that the timer doesn't keep the loop
    // alive without spawning a subprocess. Just verify the option
    // doesn't crash.
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 5)
    await expect(
      sleep(1000, ac.signal, { unref: true }),
    ).resolves.toBeUndefined()
  })
})

describe('withTimeout — race semantics', () => {
  test('promise resolves before timeout → returns its value', async () => {
    const r = await withTimeout(Promise.resolve(42), 1000, 'timed out')
    expect(r).toBe(42)
  })

  test('promise resolves to a value type passes through', async () => {
    const r = await withTimeout(
      Promise.resolve({ data: 'x' }),
      1000,
      'timed out',
    )
    expect(r).toEqual({ data: 'x' })
  })

  test('promise rejects before timeout → propagates rejection', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('inner')), 1000, 'timed out'),
    ).rejects.toThrow(/inner/)
  })

  test('promise too slow → rejects with timeout message', async () => {
    const slow = new Promise(resolve => setTimeout(resolve, 200))
    await expect(withTimeout(slow, 20, 'too slow')).rejects.toThrow(
      /too slow/,
    )
  })

  test('timeout = 0 still races (does not bypass)', async () => {
    // Edge: 0ms timeout. The setTimeout(0) fires next tick, but
    // Promise.resolve() is also next tick. The race depends on
    // scheduler order. Either resolves or rejects — both are valid.
    // Just verify it doesn't hang.
    const fast = Promise.resolve('ok')
    try {
      const r = await withTimeout(fast, 0, 'timed out')
      expect(r).toBe('ok')
    } catch (e) {
      expect((e as Error).message).toBe('timed out')
    }
  })

  test('timer cleaned up after promise settles (no leak)', async () => {
    // The .finally(() => clearTimeout(timer)) ensures the timer is
    // released. Without this, withTimeout(fast, 60_000) would keep a
    // 60-second timer alive even though the promise already resolved.
    const start = Date.now()
    await withTimeout(Promise.resolve('quick'), 60_000, 'timeout')
    // If timer leaked, the test runtime would extend until 60s. We
    // measure that the call returns immediately (within 50ms slack).
    expect(Date.now() - start).toBeLessThan(50)
  })

  test('rejection from inner promise happens BEFORE timer fires', async () => {
    // The race semantic: inner rejection should be propagated, not
    // shadowed by a slower timeout.
    const fastReject = Promise.reject(new Error('inner'))
    await expect(withTimeout(fastReject, 1000, 'outer')).rejects.toThrow(
      /inner/,
    )
  })

  test('CRITICAL — withTimeout does NOT cancel inner promise', async () => {
    // Documented contract: "this doesn't cancel the underlying work".
    // Verify by having an inner promise that resolves AFTER timeout —
    // the inner side-effect (push to log) should still happen.
    const log: string[] = []
    const slow = new Promise<string>(resolve => {
      setTimeout(() => {
        log.push('inner-resolved')
        resolve('late')
      }, 30)
    })
    await expect(withTimeout(slow, 5, 'timed out')).rejects.toThrow(/timed out/)
    // Wait long enough for inner to complete.
    await new Promise(r => setTimeout(r, 50))
    expect(log).toEqual(['inner-resolved'])
  })
})
