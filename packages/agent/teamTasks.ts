/**
 * Team-aware task operations — readers and mutators that join the
 * task list with the team config (members roster, idle/busy status).
 * Extracted from `tasks.ts` because they cross the boundary between
 * the task storage layer and the swarm team file, while
 * everything in `tasks.ts` is concerned only with the task storage
 * layer itself.
 *
 * Functions here intentionally do NOT take the task-list lock — they
 * compose `listTasks` + `updateTask` from `tasks.ts`, which take the
 * lock as needed.
 */
import { readFile } from 'fs/promises'
import { join } from 'path'

import { getTeamsDir } from '@claude-code/config/env/utils'
import { errorMessage, getErrnoCode } from '@claude-code/local-observability/errorHelpers.js'
import { jsonParse } from '@claude-code/local-observability/slowOperations.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { uniq } from '@claude-code/tool-registry/utils/array.js'

import { listTasks, updateTask } from './tasks.js'

/**
 * Team member info (subset of TeamFile member structure)
 */
export type TeamMember = {
  agentId: string
  name: string
  agentType?: string
}

/**
 * Agent status based on task ownership
 */
export type AgentStatus = {
  agentId: string
  name: string
  agentType?: string
  status: 'idle' | 'busy'
  currentTasks: string[] // task IDs the agent owns
}

/**
 * Sanitizes a name for use in file paths.
 *
 * Local-only (different policy from tasks.ts:sanitizePathComponent —
 * lowercase + alphanumeric only — to match the team-file directory
 * convention). Don't unify; the path layouts are independent.
 */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
}

/**
 * Reads team members from the team file.
 */
async function readTeamMembers(
  teamName: string,
): Promise<{ leadAgentId: string; members: TeamMember[] } | null> {
  const teamsDir = getTeamsDir()
  const teamFilePath = join(teamsDir, sanitizeName(teamName), 'config.json')
  try {
    const content = await readFile(teamFilePath, 'utf-8')
    const teamFile = jsonParse(content) as {
      leadAgentId: string
      members: TeamMember[]
    }
    return {
      leadAgentId: teamFile.leadAgentId,
      members: teamFile.members.map(m => ({
        agentId: m.agentId,
        name: m.name,
        agentType: m.agentType,
      })),
    }
  } catch (e) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return null
    }
    logForDebugging(
      `[Tasks] Failed to read team file for ${teamName}: ${errorMessage(e)}`,
    )
    return null
  }
}

/**
 * Gets the status of all agents in a team based on task ownership.
 * An agent is considered "idle" if they don't own any open tasks.
 * An agent is considered "busy" if they own at least one open task.
 *
 * @param teamName - The name of the team (also used as taskListId)
 * @returns Array of agent statuses, or null if team not found
 */
export async function getAgentStatuses(
  teamName: string,
): Promise<AgentStatus[] | null> {
  const teamData = await readTeamMembers(teamName)
  if (!teamData) {
    return null
  }

  const taskListId = sanitizeName(teamName)
  const allTasks = await listTasks(taskListId)

  // Get unresolved tasks grouped by owner (open or in_progress)
  const unresolvedTasksByOwner = new Map<string, string[]>()
  for (const task of allTasks) {
    if (task.status !== 'completed' && task.owner) {
      const existing = unresolvedTasksByOwner.get(task.owner) || []
      existing.push(task.id)
      unresolvedTasksByOwner.set(task.owner, existing)
    }
  }

  // Build status for each agent (leader is already in members)
  return teamData.members.map(member => {
    // Check both name (new) and agentId (legacy) for backwards compatibility
    const tasksByName = unresolvedTasksByOwner.get(member.name) || []
    const tasksById = unresolvedTasksByOwner.get(member.agentId) || []
    const currentTasks = uniq([...tasksByName, ...tasksById])
    return {
      agentId: member.agentId,
      name: member.name,
      agentType: member.agentType,
      status: currentTasks.length === 0 ? 'idle' : 'busy',
      currentTasks,
    }
  })
}

/**
 * Result of unassigning tasks from a teammate.
 */
export type UnassignTasksResult = {
  unassignedTasks: Array<{ id: string; subject: string }>
  notificationMessage: string
}

/**
 * Unassigns all open tasks from a teammate and builds a notification
 * message. Used when a teammate is killed or gracefully shuts down.
 *
 * @param teamName - The team/task list name
 * @param teammateId - The teammate's agent ID
 * @param teammateName - The teammate's display name
 * @param reason - How the teammate exited ('terminated' | 'shutdown')
 * @returns The unassigned tasks and a formatted notification message
 */
export async function unassignTeammateTasks(
  teamName: string,
  teammateId: string,
  teammateName: string,
  reason: 'terminated' | 'shutdown',
): Promise<UnassignTasksResult> {
  const tasks = await listTasks(teamName)
  const unresolvedAssignedTasks = tasks.filter(
    t =>
      t.status !== 'completed' &&
      (t.owner === teammateId || t.owner === teammateName),
  )

  // Unassign each task and reset status to open
  for (const task of unresolvedAssignedTasks) {
    await updateTask(teamName, task.id, {
      owner: undefined,
      status: 'pending',
    })
  }

  if (unresolvedAssignedTasks.length > 0) {
    logForDebugging(
      `[Tasks] Unassigned ${unresolvedAssignedTasks.length} task(s) from ${teammateName}`,
    )
  }

  // Build notification message
  const actionVerb =
    reason === 'terminated' ? 'was terminated' : 'has shut down'
  let notificationMessage = `${teammateName} ${actionVerb}.`
  if (unresolvedAssignedTasks.length > 0) {
    const taskList = unresolvedAssignedTasks
      .map(t => `#${t.id} "${t.subject}"`)
      .join(', ')
    notificationMessage += ` ${unresolvedAssignedTasks.length} task(s) were unassigned: ${taskList}. Use TaskList to check availability and TaskUpdate with owner to reassign them to idle teammates.`
  }

  return {
    unassignedTasks: unresolvedAssignedTasks.map(t => ({
      id: t.id,
      subject: t.subject,
    })),
    notificationMessage,
  }
}
