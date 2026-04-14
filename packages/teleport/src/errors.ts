export class TeleportBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TeleportBaseError'
    this.code = code
  }
}

export class EnvironmentSelectionError extends TeleportBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('TELEPORT_ENVIRONMENT_SELECTION_ERROR', message, options)
    this.name = 'TeleportEnvironmentSelectionError'
  }
}

export class ContextSyncError extends TeleportBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('TELEPORT_CONTEXT_SYNC_ERROR', message, options)
    this.name = 'TeleportContextSyncError'
  }
}

export class ExecutionError extends TeleportBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('TELEPORT_EXECUTION_ERROR', message, options)
    this.name = 'TeleportExecutionError'
  }
}
