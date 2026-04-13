/**
 * V7 §6.5 — ConfigError typed error namespace.
 *
 * Every error class extends ConfigBaseError which carries a stable `code`
 * string (for CI/log matching) and supports native Error.cause chaining.
 */

export class ConfigBaseError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConfigBaseError'
    this.code = code
  }
}

export class ValidationError extends ConfigBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('CONFIG_VALIDATION_ERROR', message, options)
    this.name = 'ConfigValidationError'
  }
}

export class NotFoundError extends ConfigBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('CONFIG_NOT_FOUND', message, options)
    this.name = 'ConfigNotFoundError'
  }
}

export class PermissionDeniedError extends ConfigBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('CONFIG_PERMISSION_DENIED', message, options)
    this.name = 'ConfigPermissionDeniedError'
  }
}
