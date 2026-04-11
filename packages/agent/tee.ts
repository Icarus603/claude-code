/**
 * Fan-out an AsyncIterable into `count` independent iterables.
 * Each consumer receives every item from the source. The source
 * is drained in the background; fast consumers buffer pending items
 * rather than blocking slow consumers.
 *
 * Used by runHeadless to fan out AgentEvent to output / storage /
 * observability subscribers simultaneously (V7 §9.10 Event Spine).
 */
export function tee<T>(source: AsyncIterable<T>, count = 2): AsyncIterable<T>[] {
  const queues: T[][] = Array.from({ length: count }, () => [])
  const resolvers: ((value: IteratorResult<T, undefined>) => void)[][] = Array.from(
    { length: count },
    () => [],
  )
  let sourceDone = false
  let sourceError: unknown = undefined

  function deliver(i: number, item: T): void {
    if (resolvers[i].length > 0) {
      resolvers[i].shift()!({ value: item, done: false })
    } else {
      queues[i].push(item)
    }
  }

  function close(i: number): void {
    for (const resolve of resolvers[i]) {
      resolve({ value: undefined, done: true })
    }
    resolvers[i] = []
  }

  async function drain(): Promise<void> {
    try {
      for await (const item of source) {
        for (let i = 0; i < count; i++) {
          deliver(i, item)
        }
      }
    } catch (e) {
      sourceError = e
    } finally {
      sourceDone = true
      for (let i = 0; i < count; i++) {
        close(i)
      }
    }
  }

  void drain()

  return Array.from({ length: count }, (_, i) => ({
    [Symbol.asyncIterator](): AsyncIterator<T, undefined> {
      return {
        next(): Promise<IteratorResult<T, undefined>> {
          if (queues[i].length > 0) {
            return Promise.resolve({ value: queues[i].shift()!, done: false })
          }
          if (sourceDone) {
            if (sourceError !== undefined) return Promise.reject(sourceError)
            return Promise.resolve({ value: undefined, done: true })
          }
          return new Promise<IteratorResult<T, undefined>>(resolve => {
            resolvers[i].push(resolve)
          })
        },
      }
    },
  }))
}
