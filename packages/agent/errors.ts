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
 * Thrown when blockTask would create a cycle in the task dependency graph.
 *
 * Cycles deadlock claimTask: every task in the cycle is blockedBy another
 * unresolved task in the cycle, so none can ever start. Detected at
 * write-time (not read-time filter) so the caller learns the moment they
 * try to construct a bad graph.
 *
 * The `path` is the chain we walked when we found the cycle, e.g.
 * ["A", "B", "C", "A"] — useful for the caller to fix the offending edge.
 */
export class TaskCycleError extends AgentBaseError {
  readonly path: string[]
  constructor(path: string[], options?: ErrorOptions) {
    super(
      'AGENT_TASK_CYCLE',
      `blockTask would create a cycle: ${path.join(' → ')}`,
      options,
    )
    this.name = 'TaskCycleError'
    this.path = path
  }
}

/**
 * Agent uses a symbol marker instead of an Error subclass so callers can
 * distinguish a cooperative user interrupt from provider/tool failures
 * without relying on fragile `error.message` string matching.
 */
export const UserAbort: unique symbol = Symbol('UserAbort')

export type UserAbort = typeof UserAbort
