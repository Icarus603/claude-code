import type {
  AgentDeps,
  ClaimableTask,
  IncomingMailMessage,
  MailboxDep,
  OutgoingMailMessage,
  TaskClaimingDep,
} from '@claude-code/agent'
import { markMessageAsReadByIndex, readMailbox, writeToMailbox } from '../mailbox/index.js'
import { readTeamFileAsync } from '../core/teamHelpers.js'
import type { SwarmHostDeps } from '../types/deps.js'

export type SwarmAgentIdentity = {
  teammateId: string
  name: string
  teamId: string
  role: 'worker' | 'leader'
}

export type BuildSwarmAgentDepsOptions = {
  host: SwarmHostDeps
  identity: SwarmAgentIdentity
}

export function createSwarmMailboxAdapter(
  options: BuildSwarmAgentDepsOptions,
): MailboxDep {
  const { host, identity } = options

  return {
    async poll(): Promise<IncomingMailMessage[]> {
      const messages = await readMailbox(identity.name, identity.teamId)
      return messages
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => !message.read)
        .map(({ message, index }) => ({
          from: message.from,
          fromName: message.from,
          text: message.text,
          summary: message.summary,
          index,
        }))
    },

    async markRead(index: number): Promise<void> {
      await markMessageAsReadByIndex(identity.name, identity.teamId, index)
    },

    async sendTo(peerId: string, message: OutgoingMailMessage): Promise<void> {
      await writeToMailbox(peerId, {
        from: identity.name,
        text: message.text,
        summary: message.summary,
        timestamp: new Date().toISOString(),
      }, identity.teamId)
    },

    async broadcast(message: OutgoingMailMessage): Promise<void> {
      const team = await readTeamFileAsync(identity.teamId)
      if (!team) {
        return
      }
      await Promise.all(
        team.members
          .filter(member => member.name !== identity.name)
          .map(member =>
            writeToMailbox(
              member.name,
              {
                from: identity.name,
                text: message.text,
                summary: message.summary,
                timestamp: new Date().toISOString(),
              },
              identity.teamId,
            ),
          ),
      )
    },
  }
}

export function createSwarmTaskClaimingAdapter(
  options: BuildSwarmAgentDepsOptions,
): TaskClaimingDep {
  const { host, identity } = options

  return {
    async listAvailable(): Promise<ClaimableTask[]> {
      const tasks = await host.tasks.listTasks(identity.teamId)
      return tasks
        .filter(task => task.status === 'pending')
        .map(task => ({
          taskId: task.id,
          description: task.description ?? task.subject,
        }))
    },

    async claim(taskId: string): Promise<boolean> {
      const result = await host.tasks.claimTask(
        identity.teamId,
        taskId,
        identity.name,
      )
      return result.success
    },

    async update(taskId: string, status: string): Promise<void> {
      await host.tasks.updateTask(identity.teamId, taskId, {
        status: status as 'pending' | 'in_progress' | 'completed',
      })
    },
  }
}

export async function buildSwarmAgentDeps(
  options: BuildSwarmAgentDepsOptions,
): Promise<AgentDeps> {
  const { host, identity } = options
  const systemPrompt = await host.context.getSystemPrompt()

  return {
    provider: {
      stream(params) {
        return host.api.stream(params)
      },
      getModel() {
        return host.api.getModel()
      },
    },
    tools: {
      find(name) {
        return host.tools.find(name)
      },
      list() {
        return host.tools.list()
      },
      execute(tool, input, context) {
        return host.tools.execute(tool, input, context)
      },
    },
    permission: {
      async canUseTool(tool, input, context) {
        const result = await host.permissions.canUseTool(tool, input, {
          ...context,
          input,
        })
        return {
          allowed: result.allowed,
          reason: result.reason,
        }
      },
    },
    output: {
      emit(event) {
        host.events.emit(event)
      },
    },
    hooks: {
      onTurnStart(state) {
        return host.hooks.onTurnStart(state)
      },
      onTurnEnd(state) {
        return host.hooks.onTurnEnd(state)
      },
      onStop(messages, context) {
        return host.hooks.onStop(messages, context)
      },
    },
    compaction: {
      maybeCompact(messages, tokenCount) {
        return host.compaction.maybeCompact(messages, tokenCount)
      },
    },
    context: {
      getSystemPrompt() {
        return systemPrompt.map(content => ({ content }))
      },
      getUserContext() {
        return host.context.getUserContext()
      },
      getSystemContext() {
        return host.context.getSystemContext()
      },
    },
    session: {
      recordTranscript(messages) {
        return host.session.recordTranscript(messages)
      },
      getSessionId() {
        return host.session.getSessionId()
      },
    },
    swarm: {
      identity: {
        name: identity.name,
        teamId: identity.teamId,
        teammateId: identity.teammateId,
        role: identity.role,
      },
      mailbox: createSwarmMailboxAdapter(options),
      taskClaiming: createSwarmTaskClaimingAdapter(options),
    },
  }
}
