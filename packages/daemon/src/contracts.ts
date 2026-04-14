export type DaemonWorker = {
  id: string
  kind: string
  stop(signal?: AbortSignal): Promise<void>
}

export type DaemonRuntime = {
  start(signal?: AbortSignal): Promise<void>
  stop(signal?: AbortSignal): Promise<void>
  listWorkers(): DaemonWorker[]
}
