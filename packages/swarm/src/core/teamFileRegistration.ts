import { getSessionId, logForDebugging } from '../adapters/appRuntime.js'
import {
  readTeamFileAsync,
  type TeamFile,
  updateTeamFileAsync,
} from './teamHelpers.js'

export type TeamContextSnapshot = {
  teamContext?: {
    teamName?: string
    leadAgentId?: string
    teammates: Record<
      string,
      {
        name: string
        agentType?: string
        spawnedAt: number
        tmuxPaneId: string
        cwd: string
      }
    >
  }
}

/**
 * Loads the team file, reconstructing it from AppState when it is missing but
 * the leader still believes they are in the team.
 *
 * Symptom this guards against: TeamCreate writes the team file and sets
 * appState.teamContext, but by the time a later Agent spawn runs, the file has
 * gone missing (disk cleanup, race across tool calls, corrupted write, etc.).
 * Prior behavior threw "Team X does not exist. Call spawnTeam first" which
 * misled the LLM into a TeamCreate → "Already leading team" loop.
 *
 * Recovery only fires when appState.teamContext.teamName matches the requested
 * teamName — a legitimate "I passed the wrong team_name" case still throws.
 * Reconstructed members lose metadata not kept in memory (description,
 * createdAt, per-member model/prompt/color/planModeRequired/backendType);
 * routing-critical fields (agentId, name, cwd, tmuxPaneId) survive.
 */
export async function ensureTeamFileFromSnapshot(
  teamName: string,
  snapshot: TeamContextSnapshot,
): Promise<TeamFile> {
  const existing = await readTeamFileAsync(teamName)
  if (existing) return existing

  const ensured = await updateTeamFileAsync(
    teamName,
    current => current ?? rebuildTeamFileFromSnapshot(teamName, snapshot),
  )
  if (!ensured) {
    throw new Error(
      `Team "${teamName}" does not exist. Call TeamCreate first to create the team.`,
    )
  }
  return ensured
}

export async function registerTeammateInTeamFile(
  teamName: string,
  snapshot: TeamContextSnapshot,
  member: TeamFile['members'][number],
): Promise<void> {
  await updateTeamFileAsync(teamName, teamFile => {
    const current = teamFile ?? rebuildTeamFileFromSnapshot(teamName, snapshot)
    const members = current.members.filter(m => m.agentId !== member.agentId)
    return {
      ...current,
      members: [...members, member],
    }
  })
}

function rebuildTeamFileFromSnapshot(
  teamName: string,
  snapshot: TeamContextSnapshot,
): TeamFile {
  const ctx = snapshot.teamContext
  if (!ctx || ctx.teamName !== teamName || !ctx.leadAgentId) {
    throw new Error(
      `Team "${teamName}" does not exist. Call TeamCreate first to create the team.`,
    )
  }

  logForDebugging(
    `[spawn] team file missing for "${teamName}", reconstructing from teamContext (${Object.keys(ctx.teammates).length} in-memory members)`,
  )

  const members: TeamFile['members'] = Object.entries(ctx.teammates).map(
    ([agentId, t]) => ({
      agentId,
      name: t.name,
      agentType: t.agentType,
      joinedAt: t.spawnedAt,
      tmuxPaneId: t.tmuxPaneId,
      cwd: t.cwd,
      subscriptions: [],
    }),
  )

  return {
    name: teamName,
    createdAt: Date.now(),
    leadAgentId: ctx.leadAgentId,
    leadSessionId: getSessionId(),
    members,
  }
}
