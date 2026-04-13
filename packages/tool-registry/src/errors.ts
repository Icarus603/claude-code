/**
 * V7 §6.5 — ToolError typed error namespace.
 */
export class ToolBaseError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ToolBaseError'
    this.code = code
  }
}
export class NotFoundError extends ToolBaseError {
  constructor(message: string, options?: ErrorOptions) { super('TOOL_NOT_FOUND', message, options); this.name = 'ToolNotFoundError' }
}
export class InvalidInputError extends ToolBaseError {
  constructor(message: string, options?: ErrorOptions) { super('TOOL_INVALID_INPUT', message, options); this.name = 'ToolInvalidInputError' }
}
export class ExecutionError extends ToolBaseError {
  constructor(message: string, options?: ErrorOptions) { super('TOOL_EXECUTION_ERROR', message, options); this.name = 'ToolExecutionError' }
}
