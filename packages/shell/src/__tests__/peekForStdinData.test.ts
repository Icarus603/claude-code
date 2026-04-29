import { EventEmitter } from 'events'
import { describe, expect, test } from 'bun:test'
import { peekForStdinData } from '../process.js'

describe('peekForStdinData', () => {
  // Used by -p mode to distinguish "real pipe producer" from "inherited-
  // but-idle stdin". Critical contract:
  // - Resolves false on 'end' event (stream closed → not a producer)
  // - Resolves true on timeout (no data came in time)
  // - Resolves false eventually if data arrived (cancels timeout, waits
  //   for end normally — caller needs ALL chunks)

  test('resolves false when stream emits end before timeout', async () => {
    const stream = new EventEmitter()
    const promise = peekForStdinData(stream, 1000)
    stream.emit('end')
    expect(await promise).toBe(false)
  })

  test('resolves true after timeout when no data arrives', async () => {
    const stream = new EventEmitter()
    const start = Date.now()
    const result = await peekForStdinData(stream, 30)
    const elapsed = Date.now() - start
    expect(result).toBe(true)
    // Timeout fires around the configured ms.
    expect(elapsed).toBeGreaterThanOrEqual(25)
    expect(elapsed).toBeLessThan(200)
  })

  test('first data chunk cancels timeout, subsequent end resolves false', async () => {
    const stream = new EventEmitter()
    const promise = peekForStdinData(stream, 1000)
    // Emit data first — this cancels the timeout.
    stream.emit('data', 'first chunk')
    // After data, the timeout is cancelled. Now we wait for end.
    setTimeout(() => stream.emit('end'), 10)
    expect(await promise).toBe(false)
  })

  test('end after timeout still resolves with original timeout value', async () => {
    // Once timeout fires, the promise has already resolved. Late end
    // event must NOT re-resolve.
    const stream = new EventEmitter()
    const promise = peekForStdinData(stream, 10)
    expect(await promise).toBe(true)
    // Late end emit should be a no-op (no double-resolution).
    expect(() => stream.emit('end')).not.toThrow()
  })

  test('only the FIRST data chunk cancels timeout', async () => {
    // Implementation uses .once('data', onFirstData). Subsequent data
    // events are not subscribed to.
    const stream = new EventEmitter()
    const promise = peekForStdinData(stream, 1000)
    stream.emit('data', 'chunk 1')
    stream.emit('data', 'chunk 2') // should not affect anything
    stream.emit('end')
    expect(await promise).toBe(false)
  })

  test('emits "end" listener removal — does NOT leak listeners on early data', async () => {
    // Critical: cleanup pattern. After resolution, both listeners must
    // be removed so subsequent emits don't trigger anything.
    const stream = new EventEmitter()
    const promise = peekForStdinData(stream, 1000)
    stream.emit('data', 'x')
    stream.emit('end')
    await promise
    // After resolution, listeners are removed. No 'end' listener active.
    expect(stream.listenerCount('end')).toBe(0)
    expect(stream.listenerCount('data')).toBe(0)
  })

  test('cleanup after timeout removes listeners', async () => {
    const stream = new EventEmitter()
    await peekForStdinData(stream, 10)
    expect(stream.listenerCount('end')).toBe(0)
    expect(stream.listenerCount('data')).toBe(0)
  })

  test('cleanup after early end removes listeners', async () => {
    const stream = new EventEmitter()
    const promise = peekForStdinData(stream, 1000)
    stream.emit('end')
    await promise
    expect(stream.listenerCount('end')).toBe(0)
    expect(stream.listenerCount('data')).toBe(0)
  })

  test('handles ms=0 (immediate timeout)', async () => {
    const stream = new EventEmitter()
    const result = await peekForStdinData(stream, 0)
    expect(result).toBe(true)
  })

  test('does NOT throw on data with no listeners on subsequent emits', async () => {
    const stream = new EventEmitter()
    const promise = peekForStdinData(stream, 1000)
    stream.emit('data', 'x')
    stream.emit('end')
    await promise
    // Late events after cleanup are no-ops.
    expect(() => stream.emit('end')).not.toThrow()
    expect(() => stream.emit('data', 'late')).not.toThrow()
  })
})
