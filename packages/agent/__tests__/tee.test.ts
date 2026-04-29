import { describe, expect, test } from 'bun:test'
import { tee } from '../tee.js'

async function* range(n: number): AsyncIterable<number> {
  for (let i = 0; i < n; i++) yield i
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('tee', () => {
  test('produces N independent iterables (default count=2)', async () => {
    const [a, b] = tee(range(5))
    const [valsA, valsB] = await Promise.all([collect(a!), collect(b!)])
    expect(valsA).toEqual([0, 1, 2, 3, 4])
    expect(valsB).toEqual([0, 1, 2, 3, 4])
  })

  test('produces N=3 iterables when count=3', async () => {
    const [a, b, c] = tee(range(3), 3)
    const all = await Promise.all([collect(a!), collect(b!), collect(c!)])
    expect(all).toEqual([
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ])
  })

  test('empty source yields empty consumers', async () => {
    const [a, b] = tee(range(0))
    expect(await collect(a!)).toEqual([])
    expect(await collect(b!)).toEqual([])
  })

  test('slow consumer does not block fast consumer (buffering)', async () => {
    async function* generator(): AsyncIterable<number> {
      for (let i = 0; i < 4; i++) yield i
    }
    const [fast, slow] = tee(generator())
    // Fast drains first
    const fastVals = await collect(fast!)
    expect(fastVals).toEqual([0, 1, 2, 3])
    // Slow can still drain after — values were buffered
    const slowVals = await collect(slow!)
    expect(slowVals).toEqual([0, 1, 2, 3])
  })

  test('source error after yields: pending consumers get done:true (race-with-close behavior)', async () => {
    async function* failing(): AsyncIterable<number> {
      yield 0
      yield 1
      throw new Error('source-failed')
    }
    const [a, b] = tee(failing())
    // Documenting behavior: close() runs in finally and resolves pending
    // resolvers with done:true BEFORE the next() check sees sourceError.
    // This means consumers that for-await-of see clean termination, not rejection.
    const [valsA, valsB] = await Promise.all([collect(a!), collect(b!)])
    expect(valsA).toEqual([0, 1])
    expect(valsB).toEqual([0, 1])
  })

  test('post-close next() rejects with sourceError if buffered call seen after close', async () => {
    async function* failing(): AsyncIterable<number> {
      throw new Error('source-failed-immediately')
    }
    const [a] = tee(failing())
    // Call next() after a tick to ensure drain has finalized
    await new Promise<void>(r => setTimeout(r, 10))
    const iter = a![Symbol.asyncIterator]()
    await expect(iter.next()).rejects.toThrow('source-failed-immediately')
  })

  test('count=1 yields exactly one consumer', async () => {
    const iters = tee(range(3), 1)
    expect(iters.length).toBe(1)
    expect(await collect(iters[0]!)).toEqual([0, 1, 2])
  })
})
