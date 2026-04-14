export class BridgeBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BridgeBaseError'
    this.code = code
  }
}

export class SessionError extends BridgeBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('BRIDGE_SESSION_ERROR', message, options)
    this.name = 'BridgeSessionError'
  }
}

export class AuthError extends BridgeBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('BRIDGE_AUTH_ERROR', message, options)
    this.name = 'BridgeAuthError'
  }
}

export class TransportError extends BridgeBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('BRIDGE_TRANSPORT_ERROR', message, options)
    this.name = 'BridgeTransportError'
  }
}

export class PermissionCallbackError extends BridgeBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('BRIDGE_PERMISSION_CALLBACK_ERROR', message, options)
    this.name = 'BridgePermissionCallbackError'
  }
}

export class HostBindingsError extends BridgeBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('BRIDGE_HOST_BINDINGS_ERROR', message, options)
    this.name = 'BridgeHostBindingsError'
  }
}
