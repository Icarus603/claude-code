/**
 * V7 §6.5 — MCP typed error namespace.
 */
export class McpBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'McpBaseError'
    this.code = code
  }
}

export class TransportError extends McpBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('MCP_TRANSPORT_ERROR', message, options)
    this.name = 'McpTransportError'
  }
}

export class ProtocolError extends McpBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('MCP_PROTOCOL_ERROR', message, options)
    this.name = 'McpProtocolError'
  }
}

export class AuthRequiredError extends McpBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('MCP_AUTH_REQUIRED_ERROR', message, options)
    this.name = 'McpAuthRequiredError'
  }
}

export class ElicitationError extends McpBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('MCP_ELICITATION_ERROR', message, options)
    this.name = 'McpElicitationError'
  }
}

export class HostBindingsError extends ProtocolError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'McpHostBindingsError'
  }
}
