/**
 * V7 §6.5 — OutputError typed error namespace.
 */
export class OutputBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'OutputBaseError'
    this.code = code
  }
}

export class WriteError extends OutputBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('OUTPUT_WRITE_ERROR', message, options)
    this.name = 'OutputWriteError'
  }
}

export class RenderError extends OutputBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('OUTPUT_RENDER_ERROR', message, options)
    this.name = 'OutputRenderError'
  }
}

export class TargetUnavailableError extends OutputBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('OUTPUT_TARGET_UNAVAILABLE', message, options)
    this.name = 'OutputTargetUnavailableError'
  }
}
