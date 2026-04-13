/**
 * V7 §6.5 — CommandRuntimeError typed error namespace.
 */
export class CommandRuntimeBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CommandRuntimeBaseError'
    this.code = code
  }
}

export class CommandNotFoundError extends CommandRuntimeBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('COMMAND_RUNTIME_NOT_FOUND', message, options)
    this.name = 'CommandRuntimeNotFoundError'
  }
}

export class CommandResolutionError extends CommandRuntimeBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('COMMAND_RUNTIME_RESOLUTION_ERROR', message, options)
    this.name = 'CommandRuntimeResolutionError'
  }
}

export class CommandExecutionError extends CommandRuntimeBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('COMMAND_RUNTIME_EXECUTION_ERROR', message, options)
    this.name = 'CommandRuntimeExecutionError'
  }
}

export class HostBindingsError extends CommandRuntimeBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('COMMAND_RUNTIME_HOST_BINDINGS_ERROR', message, options)
    this.name = 'CommandRuntimeHostBindingsError'
  }
}
