import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import {
  lock,
  lockSync,
  unlock,
  check,
} from '../src/utils/lockfile.ts'
import { installSwarmAppRuntime } from '../packages/swarm/src/adapters/appRuntime.ts'
import { installSwarmAppUi } from '../packages/swarm/src/adapters/appUi.ts'
import { TEAM_LEAD_NAME } from '../packages/swarm/src/core/constants.ts'
import {
  isIdleNotification,
  readMailbox,
  writeToMailbox,
} from '../packages/swarm/src/mailbox/index.ts'
import {
  spawnInProcessTeammate,
} from '../packages/swarm/src/runtime/spawnInProcess.ts'
import {
  startInProcessTeammate,
} from '../packages/swarm/src/runtime/inProcessRunner.ts'
import {
  injectUserMessageToTeammate,
} from '../packages/swarm/src/tasks/InProcessTeammateTask.tsx'

type TestTaskState = Record<string, any>

type TestAppState = {
  tasks: TestTaskState
  toolPermissionContext: {
    mode: string
    additionalWorkingDirectories: Map<string, string>
    alwaysAllowRules: Record<string, unknown>
    alwaysDenyRules: Record<string, unknown>
    alwaysAskRules: Record<string, unknown>
    isBypassPermissionsModeAvailable: boolean
  }
}

const TEST_MODEL = 'smoke-model'

function createTaskStateBase(taskId: string, type: string, description: string) {
  return {
    id: taskId,
    type,
    description,
    createdAt: Date.now(),
  }
}

function createUserMessage({ content }: { content: string }) {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content,
    },
  }
}

function createAssistantMessage(text: string) {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      id: crypto.randomUUID(),
      model: '<synthetic>',
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  }
}

async function* stubRunAgent(options: {
  promptMessages: Array<{ message: { content: string } }>
}) {
  const prompt = options.promptMessages.at(-1)?.message.content ?? ''
  yield createAssistantMessage(`echo:${prompt}`)
}

function createStore(): {
  getState: () => TestAppState
  setState: (updater: (prev: TestAppState) => TestAppState) => void
} {
  let state: TestAppState = {
    tasks: {},
    toolPermissionContext: {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    },
  }

  return {
    getState: () => state,
    setState(updater) {
      state = updater(state)
    },
  }
}

function registerTask(task: any, setAppState: (updater: (prev: TestAppState) => TestAppState) => void) {
  setAppState(prev => ({
    ...prev,
    tasks: {
      ...prev.tasks,
      [task.id]: task,
    },
  }))
}

function updateTaskState(
  taskId: string,
  setAppState: (updater: (prev: TestAppState) => TestAppState) => void,
  updater: (task: any) => any,
) {
  setAppState(prev => {
    const current = prev.tasks[taskId]
    if (!current) {
      return prev
    }
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: updater(current),
      },
    }
  })
}

function evictTerminalTask(
  taskId: string,
  setAppState: (updater: (prev: TestAppState) => TestAppState) => void,
) {
  setAppState(prev => {
    const next = { ...prev.tasks }
    delete next[taskId]
    return {
      ...prev,
      tasks: next,
    }
  })
}

async function waitFor(
  label: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 8_000,
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return
    }
    await Bun.sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function main() {
  const teamsDir = await mkdtemp(join(tmpdir(), 'swarm-e2e-'))
  const sessionId = `session-${Date.now()}`
  const store = createStore()
  let taskCounter = 0

  installSwarmAppRuntime({
    TEAMMATE_MESSAGE_TAG: 'teammate-message',
    getSystemPrompt: async () => ['smoke-system-prompt'],
    processMailboxPermissionResponse() {},
    registerPermissionCallback() {},
    unregisterPermissionCallback() {},
    logEvent() {},
    getAutoCompactThreshold: () => Number.MAX_SAFE_INTEGER,
    buildPostCompactMessages: (messages: any[]) => messages,
    compactConversation: async () => [],
    ERROR_MESSAGE_USER_ABORT: 'user-abort',
    resetMicrocompactState() {},
    createTaskStateBase,
    generateTaskId: () => `task-${++taskCounter}`,
    isTerminalTaskStatus: (status: string) =>
      status === 'completed' || status === 'failed' || status === 'killed',
    createActivityDescriptionResolver: () => () => 'working',
    createProgressTracker: () => ({}),
    getProgressUpdate: () => undefined,
    updateProgressFromMessage() {},
    runAgent: stubRunAgent,
    AGENT_COLORS: ['red', 'blue', 'green', 'yellow'],
    awaitClassifierAutoApproval: async () => undefined,
    BASH_TOOL_NAME: 'Bash',
    SEND_MESSAGE_TOOL_NAME: 'SendMessage',
    TASK_CREATE_TOOL_NAME: 'TaskCreate',
    TASK_GET_TOOL_NAME: 'TaskGet',
    TASK_LIST_TOOL_NAME: 'TaskList',
    TASK_UPDATE_TOOL_NAME: 'TaskUpdate',
    TEAM_CREATE_TOOL_NAME: 'TeamCreate',
    TEAM_DELETE_TOOL_NAME: 'TeamDelete',
    getSpinnerVerbs: () => ['thinking'],
    TURN_COMPLETION_VERBS: ['completed'],
    createAssistantAPIErrorMessage: ({ content }: { content: string }) =>
      createAssistantMessage(content),
    createUserMessage,
    SUBAGENT_REJECT_MESSAGE: 'rejected',
    SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX: 'rejected:',
    evictTaskOutput() {},
    evictTerminalTask,
    registerTask,
    STOPPED_DISPLAY_MS: 0,
    updateTaskState,
    tokenCountWithEstimation: () => 0,
    createAbortController: () => new AbortController(),
    runWithAgentContext: async (_ctx: any, fn: () => Promise<any>) => fn(),
    count: (arr: any[], fn: (item: any) => boolean) => arr.filter(fn).length,
    logForDebugging() {},
    logError() {},
    cloneFileStateCache: (state: any) => state,
    applyPermissionUpdates: (ctx: any) => ctx,
    persistPermissionUpdates() {},
    applyPermissionUpdate: (ctx: any) => ctx,
    hasPermissionsToUseTool: async () => ({ behavior: 'allow' }),
    emitTaskTerminatedSdk() {},
    sleep: (ms: number) => Bun.sleep(ms),
    jsonParse: JSON.parse,
    jsonStringify: JSON.stringify,
    asSystemPrompt: (value: any) => value,
    claimTask: async () => ({ success: false, reason: 'no task list' }),
    listTasks: async () => [],
    updateTask: async () => {},
    sanitizePathComponent: (value: string) =>
      value.replace(/[^a-zA-Z0-9._-]/g, '_'),
    getTasksDir: () => join(teamsDir, 'tasks'),
    notifyTasksUpdated() {},
    getAgentId: () => undefined,
    getAgentName: () => undefined,
    getDynamicTeamContext: () => undefined,
    getTeamName: () => undefined,
    getTeammateColor: () => undefined,
    isTeammate: () => false,
    createTeammateContext: (ctx: any) => ctx,
    runWithTeammateContext: async (_ctx: any, fn: () => Promise<any>) => fn(),
    createContentReplacementState: () => ({}),
    registerPerfettoAgent() {},
    unregisterPerfettoAgent() {},
    isPerfettoTracingEnabled: () => false,
    registerAgent() {},
    unregisterAgent() {},
    formatAgentId: (name: string, team: string) => `${name}@${team}`,
    generateRequestId: () => crypto.randomUUID(),
    parseAgentId: (value: string) => {
      const [agentName, teamName] = value.split('@')
      return { agentName, teamName }
    },
    registerCleanup: (_fn: () => Promise<void>) => () => {},
    getSessionId: () => sessionId,
    getIsNonInteractiveSession: () => false,
    getChromeFlagOverride: () => undefined,
    getFlagSettingsPath: () => undefined,
    getInlinePlugins: () => [],
    getMainLoopModelOverride: () => undefined,
    getSessionBypassPermissionsMode: () => false,
    getSessionCreatedTeams: () => new Set<string>(),
    quote: (value: string) => JSON.stringify(value),
    isInBundledMode: () => false,
    getPlatform: () => process.platform,
    getGlobalConfig: () => ({}),
    saveGlobalConfig: async () => {},
    env: {},
    execFileNoThrow: async () => ({ code: 0, stdout: '', stderr: '' }),
    execFileNoThrowWithCwd: async () => ({ code: 0, stdout: '', stderr: '' }),
    getTeamsDir: () => teamsDir,
    errorMessage: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    getErrnoCode: (error: any) => error?.code,
    lock,
    lockSync,
    unlock,
    check,
    gitExe: 'git',
    parseGitConfigValue: (value: string) => value,
    getCommonDir: async () => '.git',
    readWorktreeHeadSha: async () => undefined,
    resolveGitDir: async () => '.git',
    resolveRef: async () => undefined,
    findCanonicalGitRoot: () => process.cwd(),
    findGitRoot: () => process.cwd(),
    getBranch: async () => 'main',
    getDefaultBranch: async () => 'main',
    executeWorktreeCreateHook: async () => undefined,
    executeWorktreeRemoveHook: async () => undefined,
    hasWorktreeCreateHook: () => false,
    addFunctionHook() {},
    containsPathTraversal: (value: string) => value.includes('..'),
    getInitialSettings: async () => ({}),
    getRelativeSettingsFilePathForSource: () => undefined,
    getCwd: () => process.cwd(),
    saveCurrentProjectConfig: async () => {},
    CLAUDE_OPUS_4_6_CONFIG: { name: TEST_MODEL },
    getAPIProvider: () => 'anthropic',
  })

  installSwarmAppUi({
    Select: () => null,
    Spinner: () => null,
    useExitOnCtrlCDWithKeybindings: () => ({ pending: false, keyName: 'Ctrl+C' }),
  })

  const context = {
    setAppState: store.setState,
    getAppState: store.getState,
    options: {
      tools: [],
      mainLoopModel: TEST_MODEL,
      mcpClients: [],
      isNonInteractiveSession: false,
    },
    readFileState: {},
    contentReplacementState: undefined,
  } as any

  const spawnResult = await spawnInProcessTeammate(
    {
      name: 'worker',
      teamName: 'smoke-team',
      prompt: 'first task',
      color: 'red',
      planModeRequired: false,
      model: TEST_MODEL,
    },
    {
      setAppState: store.setState,
      toolUseId: 'tooluse-smoke',
    },
  )

  if (!spawnResult.success || !spawnResult.taskId || !spawnResult.teammateContext) {
    throw new Error(`Failed to spawn in-process teammate: ${spawnResult.error}`)
  }

  startInProcessTeammate({
    identity: store.getState().tasks[spawnResult.taskId].identity,
    taskId: spawnResult.taskId,
    prompt: 'first task',
    teammateContext: spawnResult.teammateContext,
    toolUseContext: context,
    abortController: spawnResult.abortController!,
    model: TEST_MODEL,
    systemPrompt: 'swarm smoke system prompt',
    systemPromptMode: 'replace',
    description: 'smoke-e2e',
  })

  await waitFor('first idle mailbox message', async () => {
    const inbox = await readMailbox(TEAM_LEAD_NAME, 'smoke-team')
    return inbox.length >= 1
  })

  const firstInbox = await readMailbox(TEAM_LEAD_NAME, 'smoke-team')
  if (!firstInbox[0] || !isIdleNotification(firstInbox[0].text)) {
    throw new Error('First idle notification missing from leader mailbox')
  }

  injectUserMessageToTeammate(
    spawnResult.taskId,
    'second task',
    store.setState,
  )

  await waitFor('second idle mailbox message', async () => {
    const inbox = await readMailbox(TEAM_LEAD_NAME, 'smoke-team')
    return inbox.length >= 2
  })

  const secondInbox = await readMailbox(TEAM_LEAD_NAME, 'smoke-team')
  if (!secondInbox[1] || !isIdleNotification(secondInbox[1].text)) {
    throw new Error('Second idle notification missing from leader mailbox')
  }

  const taskState = store.getState().tasks[spawnResult.taskId]
  if (!taskState || taskState.messages.length < 3) {
    throw new Error('Teammate transcript did not capture expected messages')
  }

  spawnResult.abortController?.abort()

  await waitFor('teammate cleanup', () => !(spawnResult.taskId! in store.getState().tasks))

  await writeToMailbox('worker', {
    from: TEAM_LEAD_NAME,
    text: 'mailbox-smoke',
    timestamp: new Date().toISOString(),
  }, 'smoke-team')
  const workerInbox = await readMailbox('worker', 'smoke-team')
  if (!workerInbox.some(message => message.text === 'mailbox-smoke')) {
    throw new Error('Mailbox roundtrip failed for worker inbox')
  }

  await rm(teamsDir, { recursive: true, force: true })
  console.log('swarm e2e smoke passed')
}

void main().catch(async error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
