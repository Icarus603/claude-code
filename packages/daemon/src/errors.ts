export class DaemonBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DaemonBaseError'
    this.code = code
  }
}

export class LifecycleError extends DaemonBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('DAEMON_LIFECYCLE_ERROR', message, options)
    this.name = 'DaemonLifecycleError'
  }
}

export class WorkerRegistryError extends DaemonBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('DAEMON_WORKER_REGISTRY_ERROR', message, options)
    this.name = 'DaemonWorkerRegistryError'
  }
}

export class SupervisionError extends DaemonBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('DAEMON_SUPERVISION_ERROR', message, options)
    this.name = 'DaemonSupervisionError'
  }
}
