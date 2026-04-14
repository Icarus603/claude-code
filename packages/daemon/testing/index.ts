import type { DaemonRuntime, DaemonWorker } from '../src/contracts.js'

export function createStubWorker(
  overrides: Partial<DaemonWorker> = {},
): DaemonWorker {
  return {
    id: 'worker-test',
    kind: 'test',
    stop: async () => {},
    ...overrides,
  }
}

export function createDaemonRuntimeFixture(
  workers: DaemonWorker[] = [],
): DaemonRuntime {
  return {
    async start() {},
    async stop(signal?: AbortSignal) {
      for (const worker of workers) {
        await worker.stop(signal)
      }
    },
    listWorkers: () => [...workers],
  }
}
