import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import {
  _test_resetSwarmAppRuntime,
  installSwarmAppRuntime,
} from '../../adapters/appRuntime.js'
import {
  assignTeammateColor,
  clearTeammateColors,
  getTeammateColor,
} from '../teammateColors.js'
import { AGENT_COLORS } from '../../adapters/appRuntime.js'

// AGENT_COLORS is a binding-resolved value — without
// installSwarmAppRuntime() it is the missingBinding sentinel
// (a function, not an array). Install minimal bindings here so this
// test file is independent of test-file ordering. The 6-color
// fixture has to match the live binding type so AGENT_COLORS
// looks like an array everywhere it's read.
const FIXTURE_COLORS = [
  'red', 'blue', 'green', 'yellow', 'magenta', 'cyan',
] as const

const REQUIRED_BINDING_KEYS = [
  'TEAMMATE_MESSAGE_TAG', 'ERROR_MESSAGE_USER_ABORT', 'BASH_TOOL_NAME',
  'SEND_MESSAGE_TOOL_NAME', 'TASK_CREATE_TOOL_NAME', 'TASK_GET_TOOL_NAME',
  'TASK_LIST_TOOL_NAME', 'TASK_UPDATE_TOOL_NAME', 'TEAM_CREATE_TOOL_NAME',
  'TEAM_DELETE_TOOL_NAME', 'TURN_COMPLETION_VERBS', 'SUBAGENT_REJECT_MESSAGE',
  'SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX', 'STOPPED_DISPLAY_MS',
  'AGENT_COLORS', 'CLAUDE_OPUS_4_7_CONFIG', 'env', 'getSystemPrompt',
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

beforeAll(() => {
  const bindings: Record<string, unknown> = {}
  for (const key of REQUIRED_BINDING_KEYS) {
    bindings[key] = (..._args: unknown[]) => {
      throw new Error(
        `unexpected swarm runtime binding "${key}" in teammateColors test`,
      )
    }
  }
  Object.assign(bindings, {
    AGENT_COLORS: FIXTURE_COLORS,
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
    CLAUDE_OPUS_4_7_CONFIG: { name: 'test-model' },
    env: {},
  })
  installSwarmAppRuntime(bindings)
})

afterAll(() => {
  _test_resetSwarmAppRuntime()
})

afterEach(() => {
  clearTeammateColors()
})

describe('assignTeammateColor', () => {
  test('returns the same color for the same teammateId on repeat calls (memoized)', () => {
    const first = assignTeammateColor('alice')
    const second = assignTeammateColor('alice')
    expect(first).toBe(second)
  })

  test('cycles through AGENT_COLORS in order', () => {
    const palette = AGENT_COLORS.slice(0, 3)
    const colors = ['t0', 't1', 't2'].map(assignTeammateColor)
    expect(colors).toEqual(palette as typeof colors)
  })

  test('wraps around when more teammates than palette size', () => {
    const ids = Array.from(
      { length: AGENT_COLORS.length + 1 },
      (_, i) => `t${i}`,
    )
    const colors = ids.map(assignTeammateColor)
    // first AGENT_COLORS.length should be the full palette
    expect(colors.slice(0, AGENT_COLORS.length)).toEqual(
      [...AGENT_COLORS] as typeof colors,
    )
    // the (length+1)-th teammate gets the first color again
    expect(colors[AGENT_COLORS.length]).toBe(AGENT_COLORS[0]!)
  })
})

describe('getTeammateColor', () => {
  test('returns undefined for an unassigned teammate', () => {
    expect(getTeammateColor('never-assigned')).toBeUndefined()
  })

  test('returns the assigned color after assignTeammateColor', () => {
    const assigned = assignTeammateColor('bob')
    expect(getTeammateColor('bob')).toBe(assigned)
  })
})

describe('clearTeammateColors', () => {
  test('forgets all assignments', () => {
    assignTeammateColor('alice')
    assignTeammateColor('bob')
    clearTeammateColors()
    expect(getTeammateColor('alice')).toBeUndefined()
    expect(getTeammateColor('bob')).toBeUndefined()
  })

  test('resets the color cycle index', () => {
    assignTeammateColor('alice')
    assignTeammateColor('bob')
    assignTeammateColor('charlie')
    clearTeammateColors()
    // After clear, next assignment should get the FIRST color again,
    // not the 4th. This catches a regression where colorIndex isn't reset.
    expect(assignTeammateColor('dave')).toBe(AGENT_COLORS[0]!)
  })
})
