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

  test('source error after yields: pending consumers see error AFTER buffered values', async () => {
    async function* failing(): AsyncIterable<number> {
      yield 0
      yield 1
      throw new Error('source-failed')
    }
    const [a, b] = tee(failing())
    // Both consumers receive the buffered values 0,1, then the error.
    // Bug-fix 2026-04-29: previously close() resolved pending resolvers with
    // done:true and the error was silently swallowed.
    await expect(collect(a!)).rejects.toThrow('source-failed')
    await expect(collect(b!)).rejects.toThrow('source-failed')
  })

  test('source throws immediately: each consumer rejects with the error', async () => {
    async function* failing(): AsyncIterable<number> {
      throw new Error('source-failed-immediately')
    }
    const [a, b] = tee(failing())
    await expect(collect(a!)).rejects.toThrow('source-failed-immediately')
    await expect(collect(b!)).rejects.toThrow('source-failed-immediately')
  })

  test('count=1 yields exactly one consumer', async () => {
    const iters = tee(range(3), 1)
    expect(iters.length).toBe(1)
    expect(await collect(iters[0]!)).toEqual([0, 1, 2])
  })
})
