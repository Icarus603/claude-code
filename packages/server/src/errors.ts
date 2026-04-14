export class ServerBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ServerBaseError'
    this.code = code
  }
}

export class LifecycleError extends ServerBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('SERVER_LIFECYCLE_ERROR', message, options)
    this.name = 'ServerLifecycleError'
  }
}

export class SessionTransportError extends ServerBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('SERVER_SESSION_TRANSPORT_ERROR', message, options)
    this.name = 'ServerSessionTransportError'
  }
}

export class CoordinationError extends ServerBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('SERVER_COORDINATION_ERROR', message, options)
    this.name = 'ServerCoordinationError'
  }
}
