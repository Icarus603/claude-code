export class SwarmBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SwarmBaseError'
    this.code = code
  }
}

export class SpawnError extends SwarmBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('SWARM_SPAWN_ERROR', message, options)
    this.name = 'SwarmSpawnError'
  }
}

export class MailboxError extends SwarmBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('SWARM_MAILBOX_ERROR', message, options)
    this.name = 'SwarmMailboxError'
  }
}

export class WorktreeError extends SwarmBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('SWARM_WORKTREE_ERROR', message, options)
    this.name = 'SwarmWorktreeError'
  }
}
