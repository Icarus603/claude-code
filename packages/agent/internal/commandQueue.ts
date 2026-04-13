import type { AgentMessage } from '../internalTypes.js'
import { getAgentHostBindings } from '../host.js'

export type QueuedCommand = {
  priority?: 'now' | 'next' | 'later'
  mode: string
  agentId?: string
  uuid?: string
  value: unknown
  skipSlashCommands?: boolean
  [key: string]: unknown
}

function asQueuedCommandMessage(
  command: QueuedCommand,
): AgentMessage {
  return command as unknown as AgentMessage
}

function fromQueuedCommandMessage(
  command: AgentMessage,
): QueuedCommand {
  return command as unknown as QueuedCommand
}

export function getCommandsByMaxPriority(
  maxPriority: 'now' | 'next' | 'later',
): QueuedCommand[] {
  const getCommands = getAgentHostBindings().getCommandsByMaxPriority
  if (!getCommands) {
    return []
  }
  return getCommands(maxPriority).map(fromQueuedCommandMessage)
}

export function remove(commands: QueuedCommand[]): void {
  getAgentHostBindings().removeCommandsFromQueue?.(
    commands.map(asQueuedCommandMessage),
  )
}

export function isSlashCommand(command: QueuedCommand): boolean {
  const check = getAgentHostBindings().isSlashCommand
  if (check) {
    return check(asQueuedCommandMessage(command))
  }
  return (
    typeof command.value === 'string' &&
    command.value.trim().startsWith('/') &&
    !command.skipSlashCommands
  )
}
