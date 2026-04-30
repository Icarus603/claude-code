/**
 * Integration test for writeToMailbox + the (type, requestId) dedup
 * pipeline. Complements writeToMailboxDedup.test.ts (which exercises
 * the helper extractDedupKey only) by going through the full path:
 * lockfile, file IO, dedup decision, file write.
 *
 * The swarm runtime uses a strict installSwarmAppRuntime() check —
 * every binding must be present or the call throws on first use. We
 * inline the binding map per CLAUDE.md ("mock 模式必須內聯在測試
 * 文件中"); only the keys this integration actually touches are
 * given functional bodies, the rest throw if reached so unintended
 * code paths surface immediately instead of fooling the test.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as lockfileLib from 'proper-lockfile'

import {
  _test_resetSwarmAppRuntime,
  installSwarmAppRuntime,
} from '../adapters/appRuntime.js'
import {
  createShutdownRequestMessage,
  readMailbox,
  writeToMailbox,
} from '../mailbox/index.js'

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

const TEAM = 'mailbox-integration-tests'
const collectedLogs: string[] = []

let teamsDir = ''

beforeAll(async () => {
  teamsDir = await mkdtemp(join(tmpdir(), 'ccb-mailbox-int-'))

  const bindings: Record<string, unknown> = {}
  for (const key of REQUIRED_BINDING_KEYS) {
    bindings[key] = (..._args: unknown[]) => {
      throw new Error(
        `unexpected call to swarm runtime binding "${key}" in mailbox integration test`,
      )
    }
  }

  // Only the bindings writeToMailbox / readMailbox / markMessageAsReadByIndex
  // actually touch get functional bodies. Everything else throws.
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
    getTeamsDir: () => teamsDir,
    logForDebugging: (msg: string) => {
      collectedLogs.push(msg)
    },
    logError: () => {},
    jsonParse: JSON.parse,
    jsonStringify: JSON.stringify,
    getErrnoCode: (e: unknown) => (e as NodeJS.ErrnoException | null)?.code,
    errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    sanitizePathComponent: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '-'),
    getTeamName: () => TEAM,
    getAgentName: () => 'team-lead',
    getTeammateColor: () => 'blue',
    // proper-lockfile shim — write/read APIs use these for serialization
    lock: lockfileLib.lock,
    unlock: lockfileLib.unlock,
    check: lockfileLib.check,
  })

  installSwarmAppRuntime(bindings)
})

afterAll(async () => {
  if (teamsDir) {
    await rm(teamsDir, { recursive: true, force: true })
  }
  _test_resetSwarmAppRuntime()
})

beforeEach(() => {
  collectedLogs.length = 0
})

afterEach(async () => {
  // wipe inboxes between tests so dedup state doesn't leak
  await rm(join(teamsDir, TEAM), { recursive: true, force: true }).catch(
    () => {},
  )
})

describe('writeToMailbox — full integration with dedup', () => {
  test('repeated shutdown_request with same requestId is dropped on disk', async () => {
    const msg = createShutdownRequestMessage({
      requestId: 'req-stuck',
      from: 'team-lead',
      reason: 'teardown',
    })
    const env = {
      from: 'team-lead',
      text: JSON.stringify(msg),
      timestamp: '2026-04-30T00:00:00Z',
    }

    // Mirror the real-world failure mode: leader retries the same
    // shutdown 4 times because the UI button got mashed or a
    // higher-level handler resent on the same requestId. Pre-fix this
    // stacked four entries in fixer-agent's inbox.
    await writeToMailbox('alice', env, TEAM)
    await writeToMailbox('alice', env, TEAM)
    await writeToMailbox('alice', env, TEAM)
    await writeToMailbox('alice', env, TEAM)

    const inbox = await readMailbox('alice', TEAM)
    expect(inbox.length).toBe(1)
    // Sanity: the one we kept is the original (not a corrupted variant).
    expect(JSON.parse(inbox[0]!.text).requestId).toBe('req-stuck')
  })

  test('dedup logged for visibility', async () => {
    const msg = createShutdownRequestMessage({
      requestId: 'logged-1',
      from: 'team-lead',
    })
    const env = {
      from: 'team-lead',
      text: JSON.stringify(msg),
      timestamp: 'x',
    }
    await writeToMailbox('alice', env, TEAM)
    await writeToMailbox('alice', env, TEAM)
    const dedupedLogs = collectedLogs.filter(l => l.includes('deduped'))
    expect(dedupedLogs.length).toBeGreaterThan(0)
  })

  test('different requestId values all land', async () => {
    for (let i = 0; i < 4; i++) {
      const msg = createShutdownRequestMessage({
        requestId: `req-${i}`,
        from: 'team-lead',
      })
      await writeToMailbox(
        'alice',
        {
          from: 'team-lead',
          text: JSON.stringify(msg),
          timestamp: `t${i}`,
        },
        TEAM,
      )
    }
    const inbox = await readMailbox('alice', TEAM)
    expect(inbox.length).toBe(4)
  })

  test('different recipients dedup independently', async () => {
    const msg = createShutdownRequestMessage({
      requestId: 'broadcast-1',
      from: 'team-lead',
    })
    const env = {
      from: 'team-lead',
      text: JSON.stringify(msg),
      timestamp: 'x',
    }
    // Each recipient is its own inbox file, dedup is per-inbox.
    await writeToMailbox('alice', env, TEAM)
    await writeToMailbox('bob', env, TEAM)
    await writeToMailbox('alice', env, TEAM) // dup for alice
    await writeToMailbox('bob', env, TEAM) // dup for bob

    expect((await readMailbox('alice', TEAM)).length).toBe(1)
    expect((await readMailbox('bob', TEAM)).length).toBe(1)
  })

  test('plain-text retries are kept (no dedup key)', async () => {
    const env = {
      from: 'team-lead',
      text: 'check the deploy',
      timestamp: 'x',
    }
    await writeToMailbox('alice', env, TEAM)
    await writeToMailbox('alice', env, TEAM)
    expect((await readMailbox('alice', TEAM)).length).toBe(2)
  })

  test('idle_notification (no requestId) is NOT deduped', async () => {
    // Idle notifications carry only `type` — caller decides whether
    // duplicates matter. The mailbox does not collapse them; that's
    // the attachment generator's job.
    const env = {
      from: 'alice',
      text: JSON.stringify({
        type: 'idle_notification',
        from: 'alice',
        timestamp: 'x',
      }),
      timestamp: 'x',
    }
    await writeToMailbox('team-lead', env, TEAM)
    await writeToMailbox('team-lead', env, TEAM)
    expect((await readMailbox('team-lead', TEAM)).length).toBe(2)
  })

  test('concurrent writes of same (type, requestId) collapse to 1', async () => {
    // The lockfile must serialize the writes; the dedup check inside
    // each write must observe the others. Pre-fix this would race
    // and leave 4 entries even with locking, because the dedup
    // check did not exist.
    const msg = createShutdownRequestMessage({
      requestId: 'race-1',
      from: 'team-lead',
    })
    const env = {
      from: 'team-lead',
      text: JSON.stringify(msg),
      timestamp: 'x',
    }
    await Promise.all([
      writeToMailbox('alice', env, TEAM),
      writeToMailbox('alice', env, TEAM),
      writeToMailbox('alice', env, TEAM),
      writeToMailbox('alice', env, TEAM),
    ])
    const inbox = await readMailbox('alice', TEAM)
    expect(inbox.length).toBe(1)
  })
})
