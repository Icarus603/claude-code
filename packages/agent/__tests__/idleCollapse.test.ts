/**
 * Tests for the idle-notification collapse policy in
 * packages/agent/attachments/mailbox.ts.
 *
 * The previous policy ("keep only the latest idle per sender") was
 * too aggressive — it discarded mid-turn transitions
 * (`available → interrupted → available`), changing peer-DM summaries,
 * and per-task completion idles, leaving the leader blind to
 * teammate progress.
 *
 * The new policy: drop only idle notifications that are byte-for-byte
 * identical to the immediately-previous idle from the same sender. A
 * non-idle message between idles resets the sender's run.
 *
 * `collapseConsecutiveIdleDuplicates` is a pure function — easy to
 * verify in isolation. The fixture builds raw mailbox messages and
 * checks which ones survive.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import {
  _test_resetSwarmAppRuntime,
  installSwarmAppRuntime,
} from '@claude-code/swarm/adapters/appRuntime.js'
import { createIdleNotification } from '@claude-code/swarm'
import {
  collapseConsecutiveIdleDuplicates,
  type RawMessage,
} from '../attachments/mailbox.js'

// `collapseConsecutiveIdleDuplicates` calls `isIdleNotification`
// which routes through the swarm runtime `jsonParse` binding. We
// install minimal stubs (everything throws on use except the
// handful this path actually touches), per CLAUDE.md mock rules.
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
        `unexpected call to swarm runtime binding "${key}" in idle collapse test`,
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
})

afterAll(() => {
  // Reset bindings so unit tests in other files that intentionally
  // exercise the missing-binding path (e.g. mailboxHelpers.test.ts'
  // "no bindings" suites) see the original sentinel state.
  _test_resetSwarmAppRuntime()
})

function idleMsg(
  from: string,
  options?: Parameters<typeof createIdleNotification>[1],
): RawMessage {
  return {
    from,
    text: JSON.stringify(createIdleNotification(from, options)),
    timestamp: 'x',
  }
}

function plainMsg(from: string, text = 'hello'): RawMessage {
  return { from, text, timestamp: 'x' }
}

describe('collapseConsecutiveIdleDuplicates', () => {
  test('three identical idles in a row → keep first only', () => {
    const result = collapseConsecutiveIdleDuplicates([
      idleMsg('alice', { idleReason: 'available' }),
      idleMsg('alice', { idleReason: 'available' }),
      idleMsg('alice', { idleReason: 'available' }),
    ])
    expect(result.length).toBe(1)
  })

  test('idleReason transitions are preserved', () => {
    // available → interrupted → available is real progress info.
    const result = collapseConsecutiveIdleDuplicates([
      idleMsg('alice', { idleReason: 'available' }),
      idleMsg('alice', { idleReason: 'interrupted' }),
      idleMsg('alice', { idleReason: 'available' }),
    ])
    expect(result.length).toBe(3)
  })

  test('changing summary preserves both', () => {
    const result = collapseConsecutiveIdleDuplicates([
      idleMsg('alice', { idleReason: 'available', summary: 'turn 1 done' }),
      idleMsg('alice', { idleReason: 'available', summary: 'turn 2 done' }),
    ])
    expect(result.length).toBe(2)
  })

  test('non-idle message between idles resets per-sender collapse state', () => {
    // alice idles A, sends "hi" to leader, then idles A again — both
    // idles must survive because the non-idle message is a real event
    // that breaks the run.
    const result = collapseConsecutiveIdleDuplicates([
      idleMsg('alice', { idleReason: 'available' }),
      plainMsg('alice', 'hi'),
      idleMsg('alice', { idleReason: 'available' }),
    ])
    expect(result.length).toBe(3)
  })

  test('different senders do not interfere', () => {
    const result = collapseConsecutiveIdleDuplicates([
      idleMsg('alice', { idleReason: 'available' }),
      idleMsg('bob', { idleReason: 'available' }),
      idleMsg('alice', { idleReason: 'available' }),
      idleMsg('bob', { idleReason: 'available' }),
    ])
    // alice→bob breaks alice's run from alice's perspective — but
    // alice's *next* idle still has the same key as her last one,
    // so we collapse it.
    expect(result.length).toBe(2)
    expect(result[0]!.from).toBe('alice')
    expect(result[1]!.from).toBe('bob')
  })

  test('completedTaskId variation preserves both', () => {
    const result = collapseConsecutiveIdleDuplicates([
      idleMsg('alice', {
        idleReason: 'available',
        completedTaskId: '1',
        completedStatus: 'resolved',
      }),
      idleMsg('alice', {
        idleReason: 'available',
        completedTaskId: '2',
        completedStatus: 'resolved',
      }),
    ])
    expect(result.length).toBe(2)
  })

  test('failureReason variation preserves both', () => {
    const result = collapseConsecutiveIdleDuplicates([
      idleMsg('alice', { idleReason: 'failed', failureReason: 'oom' }),
      idleMsg('alice', { idleReason: 'failed', failureReason: 'timeout' }),
    ])
    expect(result.length).toBe(2)
  })

  test('empty input passes through', () => {
    expect(collapseConsecutiveIdleDuplicates([])).toEqual([])
  })

  test('single message passes through', () => {
    const m = idleMsg('alice', { idleReason: 'available' })
    expect(collapseConsecutiveIdleDuplicates([m])).toEqual([m])
  })

  test('all non-idle messages pass through unchanged', () => {
    const msgs = [
      plainMsg('alice', 'a'),
      plainMsg('bob', 'b'),
      plainMsg('alice', 'c'),
    ]
    expect(collapseConsecutiveIdleDuplicates(msgs)).toEqual(msgs)
  })

  test('long run of identical idles → keep first only', () => {
    const idles = Array.from({ length: 10 }, () =>
      idleMsg('alice', { idleReason: 'available' }),
    )
    expect(collapseConsecutiveIdleDuplicates(idles).length).toBe(1)
  })
})
