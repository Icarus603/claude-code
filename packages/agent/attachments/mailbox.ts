/**
 * Teammate mailbox + team context attachments.
 *
 * Two attachment producers split out of the main attachments orchestrator:
 *   - getTeammateMailboxAttachments — surfaces unread inbox messages for a
 *     teammate at turn start, drives the swarm protocol contract.
 *   - getTeamContextAttachment — first-turn-only team identity preamble.
 *
 * Both are gated on agent-swarm enablement + USER_TYPE=ant.
 */
import { parse } from 'path'
import type { UUID } from 'crypto'

import type { ToolUseContext } from '@claude-code/tool-registry/Tool.js'
import type { Message } from '@claude-code/repl/replTypes/message.js'
import { getViewedTeammateTask } from '@claude-code/app-host/state/selectors.js'
import { getClaudeConfigHomeDir } from '@claude-code/config/env/utils'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import {
  isIdleNotification,
  isShutdownApproved,
  isStructuredProtocolMessage,
  markMessagesAsReadByPredicate,
  readUnreadMessages,
  removeTeammateFromTeamFile,
} from '@claude-code/swarm'
import { isInProcessTeammate } from '@claude-code/swarm/teammateContextAlias.js'
import {
  getAgentId,
  getAgentName,
  getTeamName,
  isTeamLead,
} from '@claude-code/swarm/teammateState.js'

import { isAgentSwarmsEnabled } from '../agentSwarmsEnabled.js'
import { unassignTeammateTasks } from '../teamTasks.js'
import type { Attachment } from '../attachments.js'

/**
 * Shape of a teammate-mailbox message after we've stripped the
 * `read` flag and any inbox metadata. Exported so tests can build
 * fixtures without inline-reimplementing the type.
 */
export type RawMessage = {
  from: string
  text: string
  timestamp: string
  color?: string
  summary?: string
}

/**
 * Build the (sender, idleReason, summary, completedTaskId,
 * completedStatus, failureReason) identity key used to decide whether
 * an idle notification is a true duplicate of the previous one from
 * the same sender. Anything that varies — even a different summary,
 * even reason `available → interrupted` — produces a new key and
 * the message is preserved.
 */
function makeIdleKey(idle: {
  from: string
  idleReason?: string
  summary?: string
  completedTaskId?: string
  completedStatus?: string
  failureReason?: string
}): string {
  return [
    idle.from,
    idle.idleReason ?? '',
    idle.summary ?? '',
    idle.completedTaskId ?? '',
    idle.completedStatus ?? '',
    idle.failureReason ?? '',
  ].join('|')
}

/**
 * Drop idle notifications that are byte-for-byte identical to the
 * immediately-previous idle from the same sender. The first idle in
 * each run survives so the leader sees when a state started, not
 * just that it's still ongoing. A non-idle message between two
 * idles resets the per-sender state — a teammate talking to us
 * means a fresh stretch begins.
 *
 * Exported so tests can verify the algorithm directly without
 * inline-reimplementing it; not part of any public contract.
 */
export function collapseConsecutiveIdleDuplicates(
  messages: RawMessage[],
): RawMessage[] {
  if (messages.length <= 1) return messages

  const lastIdleKeyByAgent = new Map<string, string>()
  const survivors: RawMessage[] = []
  let collapsedCount = 0

  for (const m of messages) {
    const idle = isIdleNotification(m.text)
    if (!idle) {
      // Non-idle message resets the sender's run — explicitly clear
      // it so the next idle from the same sender always survives.
      lastIdleKeyByAgent.delete(m.from)
      survivors.push(m)
      continue
    }
    const key = makeIdleKey(idle)
    if (lastIdleKeyByAgent.get(idle.from) === key) {
      collapsedCount++
      continue
    }
    lastIdleKeyByAgent.set(idle.from, key)
    survivors.push(m)
  }

  if (collapsedCount > 0) {
    logForDebugging(
      `[SwarmMailbox] Collapsed ${collapsedCount} consecutive-duplicate idle notification(s)`,
    )
  }
  return survivors
}

export async function getTeammateMailboxAttachments(
  toolUseContext: ToolUseContext,
): Promise<Attachment[]> {
  if (!isAgentSwarmsEnabled()) {
    return []
  }
  // Historical: this also gated on USER_TYPE === 'ant'. Removed because
  // ccb is single-operator self-hosted — the swarm is a first-class
  // ccb feature, and the leader needs the same teammate-mailbox
  // attachment that ant builds get; otherwise the leader spawns
  // teammates and goes blind to their progress, which is exactly the
  // failure mode the operator hit when probing this in 2026-04-30.
  // The remaining isAgentSwarmsEnabled() gate is the single source of
  // truth for "is the swarm machinery on at all".

  // Get AppState early to check for team lead status
  const appState = toolUseContext.getAppState()

  // Use agent name from helper (checks AsyncLocalStorage, then dynamicTeamContext)
  const envAgentName = getAgentName()

  // Get team name (checks AsyncLocalStorage, dynamicTeamContext, then AppState)
  const teamName = getTeamName(appState.teamContext)

  // Check if we're the team lead (uses shared logic from swarm utils)
  const teamLeadStatus = isTeamLead(appState.teamContext)

  // Check if viewing a teammate's transcript (for in-process teammates)
  const viewedTeammate = getViewedTeammateTask(appState)

  // Resolve agent name based on who we're VIEWING:
  // - If viewing a teammate, use THEIR name (to read from their mailbox)
  // - Otherwise use env var if set, or leader's name if we're the team lead
  let agentName = viewedTeammate?.identity.agentName ?? envAgentName
  if (!agentName && teamLeadStatus && appState.teamContext) {
    const leadAgentId = appState.teamContext.leadAgentId
    // Look up the lead's name from agents map (not the UUID)
    agentName = appState.teamContext.teammates[leadAgentId]?.name || 'team-lead'
  }

  logForDebugging(
    `[SwarmMailbox] getTeammateMailboxAttachments called: envAgentName=${envAgentName}, isTeamLead=${teamLeadStatus}, resolved agentName=${agentName}, teamName=${teamName}`,
  )

  // Only check inbox if running as an agent in a swarm or team lead
  if (!agentName) {
    logForDebugging(
      `[SwarmMailbox] Not checking inbox - not in a swarm or team lead`,
    )
    return []
  }

  logForDebugging(
    `[SwarmMailbox] Checking inbox for agent="${agentName}" team="${teamName || 'default'}"`,
  )

  // Check mailbox for unread messages (routes to in-process or file-based)
  // Filter out structured protocol messages (permission requests/responses, shutdown
  // messages, etc.) — these must be left unread for useInboxPoller to route to their
  // proper handlers (workerPermissions queue, sandbox queue, etc.). Without filtering,
  // attachment generation races with InboxPoller: whichever reads first marks all
  // messages as read, and if attachments wins, protocol messages get bundled as raw
  // LLM context text instead of being routed to their UI handlers.
  const allUnreadMessages = await readUnreadMessages(agentName, teamName)
  const unreadMessages = allUnreadMessages.filter(
    m => !isStructuredProtocolMessage(m.text),
  )
  logForDebugging(
    `[MailboxBridge] Found ${allUnreadMessages.length} unread message(s) for "${agentName}" (${allUnreadMessages.length - unreadMessages.length} structured protocol messages filtered out)`,
  )

  // Also check AppState.inbox for pending messages (queued mid-turn by useInboxPoller)
  // IMPORTANT: appState.inbox contains messages FROM teammates TO the leader.
  // Only show these when viewing the leader's transcript (not a teammate's).
  // When viewing a teammate, their messages come from the file-based mailbox above.
  // In-process teammates share AppState with the leader — appState.inbox contains
  // the LEADER's queued messages, not the teammate's. Skip it to prevent leakage
  // (including self-echo from broadcasts). Teammates receive messages exclusively
  // through their file-based mailbox + waitForNextPromptOrShutdown.
  // Note: viewedTeammate was already computed above for agentName resolution
  const pendingInboxMessages =
    viewedTeammate || isInProcessTeammate()
      ? [] // Viewing teammate or running as in-process teammate - don't show leader's inbox
      : appState.inbox.messages.filter(m => m.status === 'pending')
  logForDebugging(
    `[SwarmMailbox] Found ${pendingInboxMessages.length} pending message(s) in AppState.inbox`,
  )

  // Combine both sources of messages WITH DEDUPLICATION
  // The same message could exist in both file mailbox and AppState.inbox due to race conditions:
  // 1. getTeammateMailboxAttachments reads file -> finds message M
  // 2. InboxPoller reads same file -> queues M in AppState.inbox
  // 3. getTeammateMailboxAttachments reads AppState -> finds M again
  // We deduplicate using from+timestamp+text prefix as the key
  const seen = new Set<string>()
  let allMessages: RawMessage[] = []

  for (const m of [...unreadMessages, ...pendingInboxMessages]) {
    const key = `${m.from}|${m.timestamp}|${m.text.slice(0, 100)}`
    if (!seen.has(key)) {
      seen.add(key)
      allMessages.push({
        from: m.from,
        text: m.text,
        timestamp: m.timestamp,
        color: m.color,
        summary: m.summary,
      })
    }
  }

  // Collapse only consecutive *identical* idle notifications per
  // sender. The previous policy ("keep only the latest per sender")
  // discarded mid-turn transitions like `available → interrupted →
  // available`, peer-DM summaries that changed between turns, and
  // task-completion idles — leaving the leader blind to teammate
  // progress they actually need to see.
  allMessages = collapseConsecutiveIdleDuplicates(allMessages)

  if (allMessages.length === 0) {
    logForDebugging(`[SwarmMailbox] No messages to deliver, returning empty`)
    return []
  }

  logForDebugging(
    `[SwarmMailbox] Returning ${allMessages.length} message(s) as attachment for "${agentName}" (${unreadMessages.length} from file, ${pendingInboxMessages.length} from AppState, after dedup)`,
  )

  // Build the attachment BEFORE marking messages as processed
  // This prevents message loss if any operation below fails
  const attachment: Attachment[] = [
    {
      type: 'teammate_mailbox',
      messages: allMessages,
    },
  ]

  // Mark only non-structured mailbox messages as read after attachment is built.
  // Structured protocol messages stay unread for useInboxPoller to handle.
  if (unreadMessages.length > 0) {
    await markMessagesAsReadByPredicate(
      agentName,
      m => !isStructuredProtocolMessage(m.text),
      teamName,
    )
    logForDebugging(
      `[MailboxBridge] marked ${unreadMessages.length} non-structured message(s) as read for agent="${agentName}" team="${teamName || 'default'}"`,
    )
  }

  // Process shutdown_approved messages - remove teammates from team file
  // This mirrors what useInboxPoller does in interactive mode (lines 546-606)
  // In -p mode, useInboxPoller doesn't run, so we must handle this here
  if (teamLeadStatus && teamName) {
    for (const m of allMessages) {
      const shutdownApproval = isShutdownApproved(m.text)
      if (shutdownApproval) {
        const teammateToRemove = shutdownApproval.from
        logForDebugging(
          `[SwarmMailbox] Processing shutdown_approved from ${teammateToRemove}`,
        )

        // Find the teammate ID by name
        const teammateId = appState.teamContext?.teammates
          ? Object.entries(appState.teamContext.teammates).find(
              ([, t]) => t.name === teammateToRemove,
            )?.[0]
          : undefined

        if (teammateId) {
          // Remove from team file
          await removeTeammateFromTeamFile(teamName, {
            agentId: teammateId,
            name: teammateToRemove,
          })
          logForDebugging(
            `[SwarmMailbox] Removed ${teammateToRemove} from team file`,
          )

          // Unassign tasks owned by this teammate
          await unassignTeammateTasks(
            teamName,
            teammateId,
            teammateToRemove,
            'shutdown',
          )

          // Remove from teamContext in AppState
          toolUseContext.setAppState(prev => {
            if (!prev.teamContext?.teammates) return prev
            if (!(teammateId in prev.teamContext.teammates)) return prev
            const { [teammateId]: _, ...remainingTeammates } =
              prev.teamContext.teammates
            return {
              ...prev,
              teamContext: {
                ...prev.teamContext,
                teammates: remainingTeammates,
              },
            }
          })
        }
      }
    }
  }

  // Mark AppState inbox messages as processed LAST, after attachment is built
  // This ensures messages aren't lost if earlier operations fail
  if (pendingInboxMessages.length > 0) {
    const pendingIds = new Set(pendingInboxMessages.map(m => m.id))
    toolUseContext.setAppState(prev => ({
      ...prev,
      inbox: {
        messages: prev.inbox.messages.map(m =>
          pendingIds.has(m.id) ? { ...m, status: 'processed' as const } : m,
        ),
      },
    }))
  }

  return attachment
}

/**
 * Get team context attachment for teammates in a swarm.
 * Only injected on the first turn to provide team coordination instructions.
 */
export function getTeamContextAttachment(messages: Message[]): Attachment[] {
  const teamName = getTeamName()
  const agentId = getAgentId()
  const agentName = getAgentName()

  // Only inject for teammates (not team lead or non-team sessions)
  if (!teamName || !agentId) {
    return []
  }

  // Only inject on first turn - check if there are no assistant messages yet
  const hasAssistantMessage = messages.some(m => m.type === 'assistant')
  if (hasAssistantMessage) {
    return []
  }

  const configDir = getClaudeConfigHomeDir()
  const teamConfigPath = `${configDir}/teams/${teamName}/config.json`
  const taskListPath = `${configDir}/tasks/${teamName}/`

  return [
    {
      type: 'team_context',
      agentId,
      agentName: agentName || agentId,
      teamName,
      teamConfigPath,
      taskListPath,
    },
  ]
}
