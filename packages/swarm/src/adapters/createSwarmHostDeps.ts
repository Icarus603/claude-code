import { existsSync } from 'node:fs'
import {
  mkdir,
  readFile as fsReadFile,
  readdir as fsReaddir,
  rm as fsRm,
  writeFile as fsWriteFile,
} from 'node:fs/promises'
import type { ToolUseContext } from '../adapters/appRuntime.js'
import {
  CLAUDE_OPUS_4_6_CONFIG,
  claimTask,
  getAgentName,
  getMainLoopModelOverride,
  getSessionId,
  getTeamName,
  getTeamsDir,
  getTeammateColor,
  isInBundledMode,
  listTasks,
  updateTask,
  updateTaskState,
} from '../adapters/appRuntime.js'
import type {
  HostApiProvider,
  HostCompaction,
  HostContextProvider,
  HostEnvironment,
  HostEventSink,
  HostFileSystem,
  HostHookCallbacks,
  HostPermissionGate,
  HostSessionManager,
  HostTask,
  HostTaskSystem,
  HostTerminalBackend,
  HostToolRegistry,
  HostUIState,
  HostWorktreeManager,
  SwarmHostDeps,
} from '../types/deps.js'

export type CreateSwarmHostDepsOptions = {
  context?: Partial<ToolUseContext>
  api?: Partial<HostApiProvider>
  tools?: Partial<HostToolRegistry>
  permissions?: Partial<HostPermissionGate>
  compaction?: Partial<HostCompaction>
  contextProvider?: Partial<HostContextProvider>
  session?: Partial<HostSessionManager>
  events?: Partial<HostEventSink>
  hooks?: Partial<HostHookCallbacks>
  fs?: Partial<HostFileSystem>
  terminal?: HostTerminalBackend
  tasks?: Partial<HostTaskSystem>
  ui?: Partial<HostUIState>
  worktree?: Partial<HostWorktreeManager>
  env?: Partial<HostEnvironment>
}

function notImplemented(name: string): never {
  throw new Error(`Swarm host dependency not implemented: ${name}`)
}

function getToolsFromContext(
  context?: Partial<ToolUseContext>,
): readonly NonNullable<ToolUseContext['options']>['tools'] {
  return context?.options?.tools ?? []
}

function toHostTask(task: {
  id: string
  subject: string
  description?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed'
  owner?: string
  blockedBy?: string[]
}): HostTask {
  return {
    id: task.id,
    subject: task.subject,
    description: task.description,
    status:
      task.status === 'completed'
        ? 'completed'
        : task.status === 'pending'
          ? 'pending'
          : 'in_progress',
    owner: task.owner,
    blockedBy: task.blockedBy ?? [],
  }
}

export function createSwarmHostDeps(
  options: CreateSwarmHostDepsOptions = {},
): SwarmHostDeps {
  const { context } = options
  const setAppState = context?.setAppStateForTasks ?? context?.setAppState

  return {
    api: {
      async *stream(_params) {
        notImplemented('api.stream')
      },
      getModel() {
        return (
          context?.options?.mainLoopModel ??
          getMainLoopModelOverride() ??
          CLAUDE_OPUS_4_6_CONFIG.name
        )
      },
      ...options.api,
    } satisfies HostApiProvider,

    tools: {
      find(name) {
        return getToolsFromContext(context).find(
          tool =>
            tool.name === name || (tool.aliases?.includes(name) ?? false),
        )
      },
      list() {
        return [...getToolsFromContext(context)]
      },
      async execute(tool, input, toolContext) {
        const canUseTool = options.permissions?.canUseTool
          ? async (
              requestedTool: typeof tool,
              requestedInput: unknown,
              requestedContext: typeof toolContext,
            ) => {
              const result = await options.permissions!.canUseTool(
                requestedTool,
                requestedInput,
                requestedContext,
              )
              return {
                behavior: result.allowed ? 'allow' : 'deny',
                message: result.reason,
                updatedInput: requestedInput,
              }
            }
          : (async () => ({
              behavior: 'allow' as const,
              updatedInput: input,
            }))

        if (!context) {
          notImplemented('tools.execute without ToolUseContext')
        }
        const parentMessage = {
          type: 'assistant',
          message: {
            id: 'swarm-host-deps',
            content: [],
          },
          uuid: '00000000-0000-0000-0000-000000000000',
        } as const
        const result = await tool.call(
          input as never,
          context as ToolUseContext,
          canUseTool as never,
          parentMessage as never,
        )
        return {
          content: result.data,
          metadata: result.mcpMeta,
        } as never
      },
      ...options.tools,
    } satisfies HostToolRegistry,

    permissions: {
      async canUseTool() {
        return { allowed: true }
      },
      ...options.permissions,
    } satisfies HostPermissionGate,

    compaction: {
      async maybeCompact(messages) {
        return { compacted: false, messages }
      },
      ...options.compaction,
    } satisfies HostCompaction,

    context: {
      async getSystemPrompt() {
        return []
      },
      getUserContext() {
        return {}
      },
      getSystemContext() {
        return {}
      },
      ...options.contextProvider,
    } satisfies HostContextProvider,

    session: {
      async recordTranscript() {},
      getSessionId() {
        return getSessionId()
      },
      ...options.session,
    } satisfies HostSessionManager,

    events: {
      emit() {},
      ...options.events,
    } satisfies HostEventSink,

    hooks: {
      async onTurnStart() {},
      async onTurnEnd() {},
      async onStop() {
        return {
          blockingErrors: [],
          preventContinuation: false,
        }
      },
      ...options.hooks,
    } satisfies HostHookCallbacks,

    fs: {
      readFile(path) {
        return fsReadFile(path, 'utf8')
      },
      writeFile(path, content) {
        return fsWriteFile(path, content)
      },
      mkdir(path, mkdirOptions) {
        return mkdir(path, mkdirOptions)
      },
      exists(path) {
        return Promise.resolve(existsSync(path))
      },
      rm(path, rmOptions) {
        return fsRm(path, rmOptions)
      },
      readdir(path) {
        return fsReaddir(path)
      },
      ...options.fs,
    } satisfies HostFileSystem,

    terminal: options.terminal,

    tasks: {
      async listTasks(listId) {
        const tasks = await listTasks(listId)
        return tasks.map(toHostTask)
      },
      async claimTask(listId, taskId, agentName) {
        return claimTask(listId, taskId, agentName)
      },
      async updateTask(listId, taskId, updates) {
        await updateTask(listId, taskId, updates as never)
      },
      ...options.tasks,
    } satisfies HostTaskSystem,

    ui: {
      updateTask(taskId, updater) {
        if (!setAppState) {
          return
        }
        updateTaskState(taskId, setAppState, task => updater(task) as never)
      },
      getAppState() {
        return context?.getAppState?.() ?? null
      },
      ...options.ui,
    } satisfies HostUIState,

    worktree: {
      async create() {
        notImplemented('worktree.create')
      },
      async remove() {
        notImplemented('worktree.remove')
      },
      async validate() {
        return false
      },
      ...options.worktree,
    } satisfies HostWorktreeManager,

    env: {
      getTeamsDir() {
        return getTeamsDir()
      },
      getTeamName() {
        return getTeamName()
      },
      getAgentName() {
        return getAgentName()
      },
      getAgentColor() {
        return getTeammateColor()
      },
      getSessionId() {
        return getSessionId()
      },
      isEnabled(feature) {
        switch (feature) {
          case 'bundled':
            return isInBundledMode()
          default:
            return false
        }
      },
      ...options.env,
    } satisfies HostEnvironment,
  }
}
