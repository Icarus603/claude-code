/**
 * V7 §6.5 — ShellError typed error namespace.
 */
export class ShellBaseError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ShellBaseError'
    this.code = code
  }
}
export class ExecError extends ShellBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('SHELL_EXEC_ERROR', message, options)
    this.name = 'ShellExecError'
  }
}
export class TimeoutError extends ShellBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('SHELL_TIMEOUT', message, options)
    this.name = 'ShellTimeoutError'
  }
}
export class QuotingError extends ShellBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('SHELL_QUOTING_ERROR', message, options)
    this.name = 'ShellQuotingError'
  }
}
