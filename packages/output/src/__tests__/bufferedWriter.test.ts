/**
 * Tests for createBufferedWriter — batches small writes into larger
 * ones to reduce syscall overhead, with both timer-based and
 * size-based flush triggers.
 *
 * Wrong batching either:
 *   - drops writes (size threshold not triggering flush)
 *   - blocks the event loop (synchronous writeFn fires on every push)
 *   - reorders writes across overflow batches
 */
import { describe, expect, mock, test } from 'bun:test'
import { createBufferedWriter } from '../buffers/buffered-writer.js'

describe('createBufferedWriter — immediateMode', () => {
  test('writes pass through directly when immediateMode=true', () => {
    const writes: string[] = []
    const w = createBufferedWriter({
      writeFn: c => {
        writes.push(c)
      },
      immediateMode: true,
    })
    w.write('a')
    w.write('b')
    expect(writes).toEqual(['a', 'b'])
  })
})

describe('createBufferedWriter — buffered mode', () => {
  test('writes are buffered (writeFn NOT called yet)', () => {
    const writeFn = mock(() => {})
    const w = createBufferedWriter({ writeFn, flushIntervalMs: 999_999 })
    w.write('a')
    w.write('b')
    expect(writeFn).toHaveBeenCalledTimes(0)
  })

  test('flush() emits all buffered content in one call', () => {
    const writes: string[] = []
    const w = createBufferedWriter({
      writeFn: c => {
        writes.push(c)
      },
      flushIntervalMs: 999_999,
    })
    w.write('hello')
    w.write(' ')
    w.write('world')
    w.flush()
    expect(writes).toEqual(['hello world'])
  })

  test('empty buffer: flush is a no-op', () => {
    const writeFn = mock(() => {})
    const w = createBufferedWriter({ writeFn, flushIntervalMs: 999_999 })
    w.flush()
    expect(writeFn).toHaveBeenCalledTimes(0)
  })

  test('size-based flush at maxBufferSize (100 default)', async () => {
    const writes: string[] = []
    const w = createBufferedWriter({
      writeFn: c => {
        writes.push(c)
      },
      flushIntervalMs: 999_999,
      maxBufferSize: 5, // small for test
    })
    w.write('a')
    w.write('b')
    w.write('c')
    w.write('d')
    w.write('e') // 5th write triggers flushDeferred
    // flushDeferred uses setImmediate, so the write is queued for next tick.
    expect(writes).toEqual([])
    // Wait for setImmediate to fire.
    await new Promise(resolve => setImmediate(resolve))
    expect(writes).toEqual(['abcde'])
  })

  test('byte-based flush at maxBufferBytes', async () => {
    const writes: string[] = []
    const w = createBufferedWriter({
      writeFn: c => {
        writes.push(c)
      },
      flushIntervalMs: 999_999,
      maxBufferSize: Infinity,
      maxBufferBytes: 10,
    })
    w.write('hello') // 5 bytes
    w.write('world') // total 10 → triggers flushDeferred
    await new Promise(resolve => setImmediate(resolve))
    expect(writes).toEqual(['helloworld'])
  })

  test('dispose() flushes pending content', () => {
    const writes: string[] = []
    const w = createBufferedWriter({
      writeFn: c => {
        writes.push(c)
      },
      flushIntervalMs: 999_999,
    })
    w.write('important')
    w.dispose()
    expect(writes).toEqual(['important'])
  })
})

describe('createBufferedWriter — timer-based flush', () => {
  test('content flushed after flushIntervalMs', async () => {
    const writes: string[] = []
    const w = createBufferedWriter({
      writeFn: c => {
        writes.push(c)
      },
      flushIntervalMs: 50, // 50ms
    })
    w.write('delayed')
    expect(writes).toEqual([])
    // Wait for timer to fire
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(writes).toEqual(['delayed'])
  })

  test('explicit flush before timer cancels the timer', async () => {
    const writes: string[] = []
    const w = createBufferedWriter({
      writeFn: c => {
        writes.push(c)
      },
      flushIntervalMs: 200,
    })
    w.write('a')
    w.flush() // immediately
    expect(writes).toEqual(['a'])
    // Wait past the 200ms window — no second flush should fire.
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(writes).toEqual(['a'])
  })
})

describe('createBufferedWriter — overflow ordering', () => {
  test('flushDeferred preserves order across multiple overflows', async () => {
    const writes: string[] = []
    const w = createBufferedWriter({
      writeFn: c => {
        writes.push(c)
      },
      flushIntervalMs: 999_999,
      maxBufferSize: 2, // tiny for test
    })
    w.write('1')
    w.write('2') // overflow 1
    w.write('3')
    w.write('4') // overflow 2 (coalesces into pending overflow)
    await new Promise(resolve => setImmediate(resolve))
    // Order preserved: '1234' arrived in order even with two overflow events.
    const joined = writes.join('')
    expect(joined).toBe('1234')
  })
})
