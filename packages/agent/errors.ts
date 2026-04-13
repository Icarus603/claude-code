/**
 * V7 §6.5 — agent typed error namespace.
 */
export class AgentBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AgentBaseError'
    this.code = code
  }
}

export class HostBindingsError extends AgentBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('AGENT_HOST_BINDINGS_ERROR', message, options)
    this.name = 'AgentHostBindingsError'
  }
}

export class StateError extends AgentBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('AGENT_STATE_ERROR', message, options)
    this.name = 'AgentStateError'
  }
}

/**
 * Agent uses a symbol marker instead of an Error subclass so callers can
 * distinguish a cooperative user interrupt from provider/tool failures
 * without relying on fragile `error.message` string matching.
 */
export const UserAbort: unique symbol = Symbol('UserAbort')

export type UserAbort = typeof UserAbort
