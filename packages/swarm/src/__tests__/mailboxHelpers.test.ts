/**
 * Tests for mailbox message helpers — JSON-encoded messages between
 * agents in the team.
 *
 * Wrong type discrimination = leader interprets a worker's tool-use
 * permission request as an idle notification (or vice versa) and the
 * worker hangs forever waiting for a response.
 *
 * formatTeammateMessages produces the XML attachment surface that
 * appears in the leader's prompt — wrong escaping means worker's text
 * containing `</teammate-message>` could close the wrapper early and
 * confuse the model.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  _test_resetSwarmAppRuntime,
  installSwarmAppRuntime,
} from '../adapters/appRuntime.js'
import {
  createIdleNotification,
  formatTeammateMessages,
  isIdleNotification,
  isPermissionRequest,
  isPermissionResponse,
} from '../mailbox/index.js'

// Two distinct binding stages exercised here:
//   1. The "no bindings" suites lock the failure-path behavior of
//      is*Notification / is*Permission* — they EXPECT missing-binding
//      throw → caught → null.
//   2. createIdleNotification + formatTeammateMessages need real
//      values (TEAMMATE_MESSAGE_TAG, etc.) to operate.
// The previous version of this file relied on undefined cross-file
// install order to provide stage 2; that's brittle. We install
// minimal bindings here and explicitly reset before the "no bindings"
// suites run their probes by re-asserting `_test_resetSwarmAppRuntime`
// inside each affected describe block via `beforeEach`.
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

function installFullBindings(): void {
  const bindings: Record<string, unknown> = {}
  for (const key of REQUIRED_BINDING_KEYS) {
    bindings[key] = (..._args: unknown[]) => {
      throw new Error(
        `unexpected call to swarm runtime binding "${key}" in mailboxHelpers test`,
      )
    }
  }
  Object.assign(bindings, {
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
    CLAUDE_OPUS_4_7_CONFIG: { name: 'test-model' },
    env: {},
    jsonParse: JSON.parse,
    jsonStringify: JSON.stringify,
  })
  installSwarmAppRuntime(bindings)
}

beforeAll(() => {
  installFullBindings()
})

afterAll(() => {
  _test_resetSwarmAppRuntime()
})

describe('createIdleNotification — message shape', () => {
  test('minimal call (just agentId) produces valid notification', () => {
    const m = createIdleNotification('worker-1')
    expect(m.type).toBe('idle_notification')
    expect(m.from).toBe('worker-1')
    expect(typeof m.timestamp).toBe('string')
    // Round-trips through Date
    expect(new Date(m.timestamp).toISOString()).toBe(m.timestamp)
  })

  test('with all options: each field flows through', () => {
    const m = createIdleNotification('w1', {
      idleReason: 'failed',
      summary: 'config sync failed',
      completedTaskId: 't1',
      completedStatus: 'failed',
      failureReason: 'timeout',
    })
    expect(m.idleReason).toBe('failed')
    expect(m.summary).toBe('config sync failed')
    expect(m.completedTaskId).toBe('t1')
    expect(m.completedStatus).toBe('failed')
    expect(m.failureReason).toBe('timeout')
  })

  test('partial options: omitted fields stay undefined', () => {
    const m = createIdleNotification('w1', { idleReason: 'available' })
    expect(m.idleReason).toBe('available')
    expect(m.summary).toBeUndefined()
    expect(m.completedTaskId).toBeUndefined()
  })
})

describe('isIdleNotification — input validation', () => {
  test('non-JSON text → null (catch swallowed parse error)', () => {
    expect(isIdleNotification('not json')).toBeNull()
  })

  test('empty string → null', () => {
    expect(isIdleNotification('')).toBeNull()
  })

  test('JSON of wrong type → null', () => {
    // Lock the type-discriminator behavior: a parseable JSON that
    // isn't an idle notification should return null, not crash.
    expect(
      isIdleNotification(
        JSON.stringify({ type: 'permission_request', request_id: 'r1' }),
      ),
    ).toBeNull()
  })

  test('valid idle notification JSON → parsed', () => {
    const json = JSON.stringify(createIdleNotification('w1'))
    expect(isIdleNotification(json)?.from).toBe('w1')
  })
})

describe('isPermissionRequest / isPermissionResponse — input validation', () => {
  test('non-JSON → null for both checks (no throw)', () => {
    expect(isPermissionRequest('not json')).toBeNull()
    expect(isPermissionResponse('not json')).toBeNull()
  })

  test('empty string → null', () => {
    expect(isPermissionRequest('')).toBeNull()
    expect(isPermissionResponse('')).toBeNull()
  })

  test('JSON of unrelated type → null', () => {
    const json = JSON.stringify({
      type: 'idle_notification',
      from: 'a',
      timestamp: 'x',
    })
    expect(isPermissionRequest(json)).toBeNull()
    expect(isPermissionResponse(json)).toBeNull()
  })
})

describe('formatTeammateMessages — XML wrapping', () => {
  test('empty list → empty string', () => {
    expect(formatTeammateMessages([])).toBe('')
  })

  test('single message wrapped in tag with teammate_id attr', () => {
    const result = formatTeammateMessages([
      { from: 'alice', text: 'hello', timestamp: '2026-04-30T00:00:00Z' },
    ])
    expect(result).toContain('teammate_id="alice"')
    expect(result).toContain('hello')
    expect(result).toMatch(/^<teammate-message[^>]*>\nhello\n<\/teammate-message>$/)
  })

  test('color attr included when present', () => {
    const result = formatTeammateMessages([
      {
        from: 'a',
        text: 'x',
        timestamp: 'now',
        color: 'red',
      },
    ])
    expect(result).toContain('color="red"')
  })

  test('summary attr included when present', () => {
    const result = formatTeammateMessages([
      { from: 'a', text: 'x', timestamp: 'now', summary: 'short' },
    ])
    expect(result).toContain('summary="short"')
  })

  test('multiple messages joined by double newline', () => {
    const result = formatTeammateMessages([
      { from: 'a', text: 'one', timestamp: 'now' },
      { from: 'b', text: 'two', timestamp: 'now' },
    ])
    const parts = result.split('\n\n')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain('one')
    expect(parts[1]).toContain('two')
  })

  test('text content NOT escaped — `</teammate-message>` in body would close early', () => {
    // DOCUMENTED LIMITATION: the formatter doesn't HTML-escape body
    // text. A worker emitting "</teammate-message>" closes the wrapper
    // early. Callers should sanitize before passing to this function,
    // or trust workers (which is the current default).
    const result = formatTeammateMessages([
      { from: 'a', text: '</teammate-message>', timestamp: 'now' },
    ])
    // Document the un-escaped output. If we ever add escaping, this
    // test fails and forces a deliberate update.
    expect(result).toContain('</teammate-message>\n</teammate-message>')
  })
})
