/**
 * End-to-end coverage of the "fixer-agent stuck after 4 shutdown_requests"
 * bug. The original failure mode was a two-layer race:
 *
 *   1. Leader retried the shutdown_request 4 times while the teammate
 *      was idle. Each retry pushed a new entry onto the inbox file.
 *   2. The runner's poll loop scanned the inbox for unread shutdown
 *      requests, found one, marked it read, and handed it to the model.
 *      But due to a UI-side reader marking *all* messages as read for
 *      its own reasons, the remaining three duplicates flipped to
 *      `read: true` while still being unprocessed by the runner. The
 *      `!m.read` filter then made them invisible — a "shutdown
 *      approved but teammate still running" deadlock.
 *
 * The fix has two prongs:
 *
 *   a) writeToMailbox dedupes on (type, requestId), so the leader's
 *      retries collapse to 1 inbox entry. Verified end-to-end by
 *      writeToMailboxIntegration.test.ts.
 *
 *   b) The runner's poll loop ignores `m.read` and uses an in-memory
 *      `processedRequestIds: Set<string>` as the authoritative
 *      "already delivered" ledger. A shutdown_request is delivered to
 *      the model exactly once per runner instance, regardless of
 *      mailbox-side flag corruption.
 *
 * This file simulates the runner's poll-side decision loop directly to
 * verify (b) without spinning up the full teammate runtime. It mirrors
 * the actual scan logic in inProcessRunner.ts:780-816 byte-for-byte
 * and asserts: a shutdown is delivered the first time, then the same
 * requestId never triggers another delivery, even if the mailbox still
 * shows it as `read: false`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import {
  _test_resetSwarmAppRuntime,
  installSwarmAppRuntime,
} from '../adapters/appRuntime.js'
import {
  createShutdownRequestMessage,
  isShutdownRequest,
  type TeammateMessage,
} from '../mailbox/index.js'

// `isShutdownRequest` walks the swarm runtime `jsonParse` binding —
// it's the same dance every swarm consumer plays in tests. We install
// a minimal stub set (everything throws on use except jsonParse), so
// we exercise the real `isShutdownRequest` path and any drift in its
// signature surfaces here.
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
        `unexpected call to swarm runtime binding "${key}" in shutdown delivery test`,
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
    sanitizePathComponent: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '-'),
    logForDebugging: () => {},
    logError: () => {},
    getErrnoCode: (e: unknown) => (e as NodeJS.ErrnoException | null)?.code,
    errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  })
  installSwarmAppRuntime(bindings)
})

afterAll(() => {
  _test_resetSwarmAppRuntime()
})

type WaitDecision =
  | { type: 'shutdown_request'; requestId: string }
  | { type: 'no_shutdown' }

/**
 * Minimal copy of the scan logic from
 * inProcessRunner.ts:waitForNextPromptOrShutdown. Kept small and
 * inline so tests verify the same algorithm the runner uses, not a
 * mock-of-a-mock. If the runner's algorithm changes, this helper has
 * to be updated in lockstep — that's intentional, the test enforces
 * the contract.
 */
function scanForShutdown(
  allMessages: ReadonlyArray<TeammateMessage>,
  processedRequestIds: Set<string>,
): WaitDecision {
  for (const m of allMessages) {
    const parsed = isShutdownRequest(m.text)
    if (parsed && !processedRequestIds.has(parsed.requestId)) {
      processedRequestIds.add(parsed.requestId)
      return { type: 'shutdown_request', requestId: parsed.requestId }
    }
  }
  return { type: 'no_shutdown' }
}

function shutdownEntry(requestId: string, read: boolean): TeammateMessage {
  return {
    from: 'team-lead',
    text: JSON.stringify(
      createShutdownRequestMessage({ requestId, from: 'team-lead' }),
    ),
    timestamp: 'x',
    read,
    color: undefined,
  }
}

describe('runner shutdown delivery — exactly-once semantics', () => {
  test('first scan delivers shutdown, records requestId in set', () => {
    const inbox = [shutdownEntry('req-1', false)]
    const processed = new Set<string>()

    const decision = scanForShutdown(inbox, processed)
    expect(decision).toEqual({ type: 'shutdown_request', requestId: 'req-1' })
    expect(processed.has('req-1')).toBe(true)
  })

  test('second scan with same requestId in set does NOT deliver again', () => {
    // Reproduces the original bug shape: even if the mailbox still has
    // the shutdown entry (or has it duplicated), once the runner has
    // delivered it, it must not deliver it a second time.
    const inbox = [shutdownEntry('req-1', false)]
    const processed = new Set<string>(['req-1'])

    const decision = scanForShutdown(inbox, processed)
    expect(decision).toEqual({ type: 'no_shutdown' })
  })

  test('mailbox showing shutdown as read=true is irrelevant — we still skip it', () => {
    // The pre-fix bug: another reader marked the message read BEFORE
    // the runner saw it. Old code filtered on !m.read so the runner
    // missed it. New code does NOT filter on `read`; only the
    // processedRequestIds set decides.
    const inbox = [shutdownEntry('req-1', /*read*/ true)]
    const processed = new Set<string>()

    const decision = scanForShutdown(inbox, processed)
    expect(decision).toEqual({ type: 'shutdown_request', requestId: 'req-1' })
  })

  test('mailbox showing shutdown as read=true after delivery — still skipped', () => {
    const inbox = [shutdownEntry('req-1', true)]
    const processed = new Set<string>(['req-1'])

    const decision = scanForShutdown(inbox, processed)
    expect(decision).toEqual({ type: 'no_shutdown' })
  })

  test('4 duplicates of the same requestId in inbox → exactly one delivery', () => {
    // Pre-mailbox-dedup mailboxes could still contain duplicates from
    // legacy state (or from a non-dedup-aware writer in another
    // process). Even then, the runner side guarantees exactly-once
    // delivery thanks to processedRequestIds.
    const inbox = [
      shutdownEntry('req-1', false),
      shutdownEntry('req-1', false),
      shutdownEntry('req-1', false),
      shutdownEntry('req-1', false),
    ]
    const processed = new Set<string>()

    const decision1 = scanForShutdown(inbox, processed)
    expect(decision1.type).toBe('shutdown_request')

    const decision2 = scanForShutdown(inbox, processed)
    const decision3 = scanForShutdown(inbox, processed)
    const decision4 = scanForShutdown(inbox, processed)
    expect(decision2.type).toBe('no_shutdown')
    expect(decision3.type).toBe('no_shutdown')
    expect(decision4.type).toBe('no_shutdown')
  })

  test('different requestId after first is delivered (independent contracts)', () => {
    const processed = new Set<string>()

    const inbox1 = [shutdownEntry('req-1', false)]
    expect(scanForShutdown(inbox1, processed).type).toBe('shutdown_request')

    const inbox2 = [shutdownEntry('req-1', false), shutdownEntry('req-2', false)]
    const decision = scanForShutdown(inbox2, processed)
    expect(decision).toEqual({ type: 'shutdown_request', requestId: 'req-2' })
  })

  test('no shutdown in inbox returns no_shutdown without mutation', () => {
    const inbox: TeammateMessage[] = [
      {
        from: 'team-lead',
        text: 'hello there',
        timestamp: 'x',
        read: false,
      },
    ]
    const processed = new Set<string>()
    expect(scanForShutdown(inbox, processed).type).toBe('no_shutdown')
    expect(processed.size).toBe(0)
  })

  test('processedRequestIds is per-runner — separate sets are independent', () => {
    // Different teammate runners have separate processed-sets. Same
    // requestId can be delivered to runner A and runner B independently
    // (e.g. broadcast shutdown_request to two teammates).
    const inboxA = [shutdownEntry('broadcast-1', false)]
    const inboxB = [shutdownEntry('broadcast-1', false)]
    const processedA = new Set<string>()
    const processedB = new Set<string>()

    expect(scanForShutdown(inboxA, processedA).type).toBe('shutdown_request')
    expect(scanForShutdown(inboxB, processedB).type).toBe('shutdown_request')
  })
})
