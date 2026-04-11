import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installSwarmAppRuntime } from '../../../../packages/swarm/src/adapters/appRuntime.js'
import {
  readTeamFileAsync,
  type TeamFile,
  writeTeamFileAsync,
} from '@claude-code/swarm'
import { ensureTeamFile } from '../spawnMultiAgent.js'
import type { AppState } from '../../../state/AppState.js'

// The swarm runtime uses late-bound export-lets. installSwarmAppRuntime() is
// strict — it throws if any expected key is missing — so we stub every key
// with a function that throws on use, then override only the handful that
// readTeamFileAsync / writeTeamFileAsync / ensureTeamFile actually touch.
// Inlined per CLAUDE.md: "mock 模式必須內聯在測試文件中，不能從共享 helper 導入".
const REQUIRED_BINDING_KEYS = [
  'TEAMMATE_MESSAGE_TAG', 'ERROR_MESSAGE_USER_ABORT', 'BASH_TOOL_NAME',
  'SEND_MESSAGE_TOOL_NAME', 'TASK_CREATE_TOOL_NAME', 'TASK_GET_TOOL_NAME',
  'TASK_LIST_TOOL_NAME', 'TASK_UPDATE_TOOL_NAME', 'TEAM_CREATE_TOOL_NAME',
  'TEAM_DELETE_TOOL_NAME', 'TURN_COMPLETION_VERBS', 'SUBAGENT_REJECT_MESSAGE',
  'SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX', 'STOPPED_DISPLAY_MS',
  'AGENT_COLORS', 'CLAUDE_OPUS_4_6_CONFIG', 'env', 'getSystemPrompt',
  'processMailboxPermissionResponse', 'registerPermissionCallback',
  'unregisterPermissionCallback', 'logEvent', 'getAutoCompactThreshold',
  'buildPostCompactMessages', 'compactConversation', 'resetMicrocompactState',
  'createTaskStateBase', 'generateTaskId', 'isTerminalTaskStatus',
  'createActivityDescriptionResolver', 'createProgressTracker',
  'getProgressUpdate', 'updateProgressFromMessage', 'runAgent',
  'awaitClassifierAutoApproval', 'getSpinnerVerbs',
  'createAssistantAPIErrorMessage', 'createUserMessage', 'evictTaskOutput',
  'evictTerminalTask', 'registerTask', 'updateTaskState',
  'tokenCountWithEstimation', 'createAbortController', 'runWithAgentContext',
  'count', 'logForDebugging', 'logError', 'cloneFileStateCache',
  'applyPermissionUpdates', 'persistPermissionUpdates', 'applyPermissionUpdate',
  'hasPermissionsToUseTool', 'emitTaskTerminatedSdk', 'sleep', 'jsonParse',
  'jsonStringify', 'asSystemPrompt', 'claimTask', 'listTasks', 'updateTask',
  'sanitizePathComponent', 'getTasksDir', 'notifyTasksUpdated',
  'createTeammateContext', 'runWithTeammateContext', 'getAgentId',
  'getAgentName', 'getDynamicTeamContext', 'getTeamName', 'getTeammateColor',
  'isTeammate', 'registerPerfettoAgent', 'unregisterPerfettoAgent',
  'isPerfettoTracingEnabled', 'registerAgent', 'unregisterAgent',
  'createContentReplacementState', 'formatAgentId', 'generateRequestId',
  'parseAgentId', 'registerCleanup', 'getSessionId',
  'getIsNonInteractiveSession', 'getChromeFlagOverride', 'getFlagSettingsPath',
  'getInlinePlugins', 'getMainLoopModelOverride',
  'getSessionBypassPermissionsMode', 'getSessionCreatedTeams', 'quote',
  'isInBundledMode', 'getPlatform', 'getGlobalConfig', 'saveGlobalConfig',
  'execFileNoThrow', 'execFileNoThrowWithCwd', 'getTeamsDir', 'errorMessage',
  'getErrnoCode', 'lock', 'lockSync', 'unlock', 'check', 'gitExe',
  'parseGitConfigValue', 'getCommonDir', 'readWorktreeHeadSha', 'resolveGitDir',
  'resolveRef', 'findCanonicalGitRoot', 'findGitRoot', 'getBranch',
  'getDefaultBranch', 'executeWorktreeCreateHook', 'executeWorktreeRemoveHook',
  'hasWorktreeCreateHook', 'addFunctionHook', 'containsPathTraversal',
  'getInitialSettings', 'getRelativeSettingsFilePathForSource', 'getCwd',
  'saveCurrentProjectConfig', 'getAPIProvider',
] as const

let teamsDir = ''

beforeAll(async () => {
  teamsDir = await mkdtemp(join(tmpdir(), 'ensure-team-file-'))

  const bindings: Record<string, unknown> = {}
  for (const key of REQUIRED_BINDING_KEYS) {
    bindings[key] = () => {
      throw new Error(`unexpected call to swarm runtime binding "${key}" in test`)
    }
  }
  Object.assign(bindings, {
    // String/array/object constants
    TEAMMATE_MESSAGE_TAG: 'teammate-message',
    ERROR_MESSAGE_USER_ABORT: '',
    BASH_TOOL_NAME: 'Bash',
    SEND_MESSAGE_TOOL_NAME: 'SendMessage',
    TASK_CREATE_TOOL_NAME: 'TaskCreate',
    TASK_GET_TOOL_NAME: 'TaskGet',
    TASK_LIST_TOOL_NAME: 'TaskList',
    TASK_UPDATE_TOOL_NAME: 'TaskUpdate',
    TEAM_CREATE_TOOL_NAME: 'TeamCreate',
    TEAM_DELETE_TOOL_NAME: 'TeamDelete',
    TURN_COMPLETION_VERBS: [],
    SUBAGENT_REJECT_MESSAGE: '',
    SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX: '',
    STOPPED_DISPLAY_MS: 0,
    AGENT_COLORS: ['red', 'blue'],
    CLAUDE_OPUS_4_6_CONFIG: { name: 'test-model' },
    env: {},
    // File helpers that readTeamFileAsync / writeTeamFileAsync actually call
    getTeamsDir: () => teamsDir,
    logForDebugging: () => {},
    logError: () => {},
    jsonParse: JSON.parse,
    jsonStringify: JSON.stringify,
    getErrnoCode: (e: unknown) => (e as NodeJS.ErrnoException | null)?.code,
    errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    // Note: spawnMultiAgent.ts imports getSessionId directly from
    // bootstrap/state.js (not via the swarm runtime binding), so the stub
    // here is never reached — real session UUID is used instead.
    getSessionId: () => 'unreachable-stub',
  })

  installSwarmAppRuntime(bindings)
})

afterAll(async () => {
  if (teamsDir) {
    await rm(teamsDir, { recursive: true, force: true })
  }
})

// Each test starts from an empty teams dir so state doesn't leak across cases.
beforeEach(async () => {
  await rm(teamsDir, { recursive: true, force: true })
  await mkdtemp(teamsDir).catch(() => {})
  // mkdtemp(existingPath) fails; just recreate by letting writeTeamFileAsync
  // mkdir on demand. The dir doesn't need to exist beforehand.
})

function makeAppStateWithTeam(
  teamName: string,
  teammateEntries: Record<
    string,
    { name: string; agentType?: string; cwd: string }
  > = {},
): AppState {
  return {
    teamContext: {
      teamName,
      teamFilePath: join(teamsDir, teamName, 'config.json'),
      leadAgentId: `team-lead@${teamName}`,
      teammates: Object.fromEntries(
        Object.entries(teammateEntries).map(([agentId, t]) => [
          agentId,
          {
            name: t.name,
            agentType: t.agentType,
            color: undefined,
            tmuxSessionName: 'in-process',
            tmuxPaneId: 'in-process',
            cwd: t.cwd,
            spawnedAt: 1000,
          },
        ]),
      ),
    },
    // ensureTeamFile only reads teamContext; other AppState fields are irrelevant
  } as unknown as AppState
}

describe('ensureTeamFile', () => {
  test('returns the existing team file unchanged when it is on disk', async () => {
    const teamName = 'existing'
    const original: TeamFile = {
      name: teamName,
      description: 'original description',
      createdAt: 42,
      leadAgentId: `team-lead@${teamName}`,
      leadSessionId: 'original-session',
      members: [
        {
          agentId: `team-lead@${teamName}`,
          name: 'team-lead',
          agentType: 'team-lead',
          joinedAt: 42,
          tmuxPaneId: '',
          cwd: '/original/cwd',
          subscriptions: [],
        },
      ],
    }
    await writeTeamFileAsync(teamName, original)

    const appState = makeAppStateWithTeam(teamName)
    const loaded = await ensureTeamFile(teamName, appState)

    expect(loaded.name).toBe(teamName)
    expect(loaded.description).toBe('original description')
    expect(loaded.createdAt).toBe(42)
    expect(loaded.leadSessionId).toBe('original-session')
    expect(loaded.members).toHaveLength(1)
  })

  test('reconstructs the team file from teamContext when it is missing', async () => {
    const teamName = 'vanished'
    const appState = makeAppStateWithTeam(teamName, {
      [`alpha@${teamName}`]: { name: 'alpha', agentType: 'general-purpose', cwd: '/work/alpha' },
      [`beta@${teamName}`]: { name: 'beta', agentType: 'explore', cwd: '/work/beta' },
    })

    // Confirm no file exists on disk yet
    const filePath = join(teamsDir, teamName, 'config.json')
    await expect(stat(filePath)).rejects.toThrow()

    const rebuilt = await ensureTeamFile(teamName, appState)

    // Returned value matches reconstruction
    expect(rebuilt.name).toBe(teamName)
    expect(rebuilt.leadAgentId).toBe(`team-lead@${teamName}`)
    // leadSessionId comes from bootstrap/state.getSessionId() — a real UUID,
    // not a stub (spawnMultiAgent imports it directly, not via the swarm
    // runtime binding we installed). Just check it's populated.
    expect(rebuilt.leadSessionId).toEqual(expect.any(String))
    expect(rebuilt.leadSessionId.length).toBeGreaterThan(0)
    expect(rebuilt.members).toHaveLength(2)
    const names = rebuilt.members.map(m => m.name).sort()
    expect(names).toEqual(['alpha', 'beta'])
    const alpha = rebuilt.members.find(m => m.name === 'alpha')!
    expect(alpha.agentId).toBe(`alpha@${teamName}`)
    expect(alpha.agentType).toBe('general-purpose')
    expect(alpha.cwd).toBe('/work/alpha')

    // Reconstructed file is persisted to disk so a follow-up read succeeds
    const onDisk = await readTeamFileAsync(teamName)
    expect(onDisk).not.toBeNull()
    expect(onDisk!.members).toHaveLength(2)
    const persisted = JSON.parse(await readFile(filePath, 'utf-8')) as TeamFile
    expect(persisted.name).toBe(teamName)
  })

  test('throws when the file is missing and teamContext does not match', async () => {
    const appState = makeAppStateWithTeam('other-team')

    await expect(ensureTeamFile('missing', appState)).rejects.toThrow(
      /Team "missing" does not exist/,
    )
  })

  test('throws when the file is missing and teamContext is undefined', async () => {
    const appState = { teamContext: undefined } as unknown as AppState

    await expect(ensureTeamFile('orphan', appState)).rejects.toThrow(
      /Team "orphan" does not exist/,
    )
  })
})
