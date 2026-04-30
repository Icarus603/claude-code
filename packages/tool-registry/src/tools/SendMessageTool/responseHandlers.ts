/**
 * Protocol-response handlers for SendMessage. Extracted from
 * SendMessageTool.ts so the dispatch table stays scannable. Each
 * handler is a pure mailbox+abort sequence — no shared state,
 * easy to read in isolation.
 *
 * Handlers covered:
 *   - handleShutdownApproval / handleShutdownRejection — teammate
 *     replies to a leader's shutdown_request.
 *   - handlePlanApproval / handlePlanRejection — leader replies to
 *     a teammate's plan_approval_request.
 *
 * The "approve" path for in-process teammates does an abort + verify
 * dance: signal.aborted must flip true synchronously, otherwise we
 * throw rather than return success (Phase C2 fix for the fixer-agent
 * "approved but still running" deadlock).
 */
import { findTeammateTaskByAgentId } from '@claude-code/swarm'
import { gracefulShutdown } from '@claude-code/app-host/bootstrap/gracefulShutdown.js'
import { jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import {
  createShutdownApprovedMessage,
  createShutdownRejectedMessage,
  readTeamFileAsync,
  TEAM_LEAD_NAME,
  writeToMailbox,
} from '@claude-code/swarm'
import {
  getAgentId,
  getAgentName,
  getTeammateColor,
  getTeamName,
  isTeamLead,
} from '@claude-code/swarm/teammateState.js'
import type { BackendType } from '@claude-code/swarm'
import type { ToolUseContext } from '../../Tool.js'

import type { ResponseOutput } from './types.js'

export async function handleShutdownApproval(
  requestId: string,
  context: ToolUseContext,
): Promise<{ data: ResponseOutput }> {
  const teamName = getTeamName()
  const agentId = getAgentId()
  const agentName = getAgentName() || 'teammate'

  logForDebugging(
    `[SendMessageTool] handleShutdownApproval: teamName=${teamName}, agentId=${agentId}, agentName=${agentName}`,
  )

  let ownPaneId: string | undefined
  let ownBackendType: BackendType | undefined
  if (teamName) {
    const teamFile = await readTeamFileAsync(teamName)
    if (teamFile && agentId) {
      const selfMember = teamFile.members.find(m => m.agentId === agentId)
      if (selfMember) {
        ownPaneId = selfMember.tmuxPaneId
        ownBackendType = selfMember.backendType
      }
    }
  }

  const approvedMessage = createShutdownApprovedMessage({
    requestId,
    from: agentName,
    paneId: ownPaneId,
    backendType: ownBackendType,
  })

  await writeToMailbox(
    TEAM_LEAD_NAME,
    {
      from: agentName,
      text: jsonStringify(approvedMessage),
      timestamp: new Date().toISOString(),
      color: getTeammateColor(),
    },
    teamName,
  )

  if (ownBackendType === 'in-process') {
    logForDebugging(
      `[SendMessageTool] In-process teammate ${agentName} approving shutdown - signaling abort`,
    )

    if (agentId) {
      const appState = context.getAppState()
      const task = findTeammateTaskByAgentId(agentId, appState.tasks)
      if (task?.abortController) {
        task.abortController.abort()
        // Verify abort took effect before returning. Without this we
        // had a race where the model-thread call returned, the
        // teammate's poll loop got into its next 500ms tick, and
        // because `signal.aborted` hadn't been observed yet the loop
        // continued — locking us into a "shutdown approved but
        // teammate still alive" state until something else happened.
        // signal.aborted flips synchronously inside .abort() per the
        // Node spec; we read it back just to be defensive against
        // shimmed AbortController implementations.
        if (!task.abortController.signal.aborted) {
          throw new Error(
            `[SendMessageTool] handleShutdownApproval: abortController.abort() did not flip signal.aborted=true for ${agentName} — refusing to claim shutdown success`,
          )
        }
        logForDebugging(
          `[SendMessageTool] Aborted controller for in-process teammate ${agentName} (signal.aborted confirmed)`,
        )
      } else {
        logForDebugging(
          `[SendMessageTool] Warning: Could not find task/abortController for ${agentName}`,
        )
      }
    }
  } else {
    if (agentId) {
      const appState = context.getAppState()
      const task = findTeammateTaskByAgentId(agentId, appState.tasks)
      if (task?.abortController) {
        logForDebugging(
          `[SendMessageTool] Fallback: Found in-process task for ${agentName} via AppState, aborting`,
        )
        task.abortController.abort()
        if (!task.abortController.signal.aborted) {
          throw new Error(
            `[SendMessageTool] handleShutdownApproval: fallback abortController.abort() did not flip signal.aborted=true for ${agentName}`,
          )
        }

        return {
          data: {
            success: true,
            message: `Shutdown approved (fallback path). Agent ${agentName} is now exiting.`,
            request_id: requestId,
          },
        }
      }
    }

    setImmediate(async () => {
      await gracefulShutdown(0, 'other')
    })
  }

  return {
    data: {
      success: true,
      message: `Shutdown approved. Sent confirmation to team-lead. Agent ${agentName} is now exiting.`,
      request_id: requestId,
    },
  }
}

export async function handleShutdownRejection(
  requestId: string,
  reason: string,
): Promise<{ data: ResponseOutput }> {
  const teamName = getTeamName()
  const agentName = getAgentName() || 'teammate'

  const rejectedMessage = createShutdownRejectedMessage({
    requestId,
    from: agentName,
    reason,
  })

  await writeToMailbox(
    TEAM_LEAD_NAME,
    {
      from: agentName,
      text: jsonStringify(rejectedMessage),
      timestamp: new Date().toISOString(),
      color: getTeammateColor(),
    },
    teamName,
  )

  return {
    data: {
      success: true,
      message: `Shutdown rejected. Reason: "${reason}". Continuing to work.`,
      request_id: requestId,
    },
  }
}

export async function handlePlanApproval(
  recipientName: string,
  requestId: string,
  context: ToolUseContext,
): Promise<{ data: ResponseOutput }> {
  const appState = context.getAppState()
  const teamName = appState.teamContext?.teamName

  if (!isTeamLead(appState.teamContext)) {
    throw new Error(
      'Only the team lead can approve plans. Teammates cannot approve their own or other plans.',
    )
  }

  const leaderMode = appState.toolPermissionContext.mode
  const modeToInherit = leaderMode === 'plan' ? 'default' : leaderMode

  const approvalResponse = {
    type: 'plan_approval_response',
    requestId,
    approved: true,
    timestamp: new Date().toISOString(),
    permissionMode: modeToInherit,
  }

  await writeToMailbox(
    recipientName,
    {
      from: TEAM_LEAD_NAME,
      text: jsonStringify(approvalResponse),
      timestamp: new Date().toISOString(),
    },
    teamName,
  )

  return {
    data: {
      success: true,
      message: `Plan approved for ${recipientName}. They will receive the approval and can proceed with implementation.`,
      request_id: requestId,
    },
  }
}

export async function handlePlanRejection(
  recipientName: string,
  requestId: string,
  feedback: string,
  context: ToolUseContext,
): Promise<{ data: ResponseOutput }> {
  const appState = context.getAppState()
  const teamName = appState.teamContext?.teamName

  if (!isTeamLead(appState.teamContext)) {
    throw new Error(
      'Only the team lead can reject plans. Teammates cannot reject their own or other plans.',
    )
  }

  const rejectionResponse = {
    type: 'plan_approval_response',
    requestId,
    approved: false,
    feedback,
    timestamp: new Date().toISOString(),
  }

  await writeToMailbox(
    recipientName,
    {
      from: TEAM_LEAD_NAME,
      text: jsonStringify(rejectionResponse),
      timestamp: new Date().toISOString(),
    },
    teamName,
  )

  return {
    data: {
      success: true,
      message: `Plan rejected for ${recipientName} with feedback: "${feedback}"`,
      request_id: requestId,
    },
  }
}
