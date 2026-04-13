/**
 * V7 §6.5 — PermissionError typed error namespace.
 */
export class PermissionBaseError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PermissionBaseError'
    this.code = code
  }
}

export class DeniedError extends PermissionBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('PERMISSION_DENIED', message, options)
    this.name = 'PermissionDeniedError'
  }
}

export class AskRequiredError extends PermissionBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('PERMISSION_ASK_REQUIRED', message, options)
    this.name = 'PermissionAskRequiredError'
  }
}

export class ContextError extends PermissionBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('PERMISSION_CONTEXT_ERROR', message, options)
    this.name = 'PermissionContextError'
  }
}

export class AbortError extends PermissionBaseError {
  constructor(message: string = 'Permission request aborted', options?: ErrorOptions) {
    super('PERMISSION_ABORTED', message, options)
    this.name = 'PermissionAbortError'
  }
}

export class HostBindingsError extends PermissionBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('PERMISSION_HOST_BINDINGS_ERROR', message, options)
    this.name = 'PermissionHostBindingsError'
  }
}
