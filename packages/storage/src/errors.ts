/**
 * V7 §6.5 — StorageError typed error namespace.
 */
export class StorageBaseError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StorageBaseError'
    this.code = code
  }
}

export class NotFoundError extends StorageBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('STORAGE_NOT_FOUND', message, options)
    this.name = 'StorageNotFoundError'
  }
}

export class ConflictError extends StorageBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('STORAGE_CONFLICT', message, options)
    this.name = 'StorageConflictError'
  }
}

export class BackendError extends StorageBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('STORAGE_BACKEND_ERROR', message, options)
    this.name = 'StorageBackendError'
  }
}
