
import type { CoreTool, ToolResult, ToolExecContext } from '@claude-code/agent'
import type { CoreMessage } from '@claude-code/agent'


export interface HostApiProvider {
  stream(params: {
    systemPrompt: unknown
    messages: CoreMessage[]
    tools: CoreTool[]
    model: string
    abortSignal?: AbortSignal
    [key: string]: unknown
  }): AsyncIterable<unknown>
  getModel(): string
}

export interface HostToolRegistry {
  find(name: string): CoreTool | undefined
  list(): CoreTool[]
  execute(tool: CoreTool, input: unknown, context: ToolExecContext): Promise<ToolResult>
}

export interface HostPermissionGate {
  canUseTool(
    tool: CoreTool,
    input: unknown,
    context: { mode: string; input: unknown; [key: string]: unknown },
  ): Promise<{ allowed: boolean; reason?: string }>
}

export interface HostCompaction {
  maybeCompact(
    messages: CoreMessage[],
    tokenCount: number,
  ): Promise<{
    compacted: boolean
    messages: CoreMessage[]
    tokensSaved?: number
  }>
}

export interface HostContextProvider {
  getSystemPrompt(): Promise<unknown[]>
  getUserContext(): Record<string, string>
  getSystemContext(): Record<string, string>
}

export interface HostSessionManager {
  recordTranscript(messages: CoreMessage[]): Promise<void>
  getSessionId(): string
}

export interface HostEventSink {
  emit(event: unknown): void
}

export interface HostHookCallbacks {
  onTurnStart(state: unknown): Promise<void>
  onTurnEnd(state: unknown): Promise<void>
  /** Stop hook */
  onStop(
    messages: CoreMessage[],
    context: { [key: string]: unknown },
  ): Promise<{
    blockingErrors: string[]
    preventContinuation: boolean
  }>
}


export interface HostFileSystem {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  exists(path: string): Promise<boolean>
  rm(path: string, options?: { recursive?: boolean }): Promise<void>
  readdir(path: string): Promise<string[]>
}


export interface HostTerminalBackend {
  detect(): Promise<TerminalEnvironment>
  createPane(options: PaneCreateOptions): Promise<PaneHandle>
  destroyPane(handle: PaneHandle): Promise<void>
  sendToPane(handle: PaneHandle, text: string): Promise<void>
  setPaneVisible(handle: PaneHandle, visible: boolean): Promise<void>
}

export type TerminalEnvironment = {
  type: 'tmux-internal' | 'tmux-external' | 'iterm2' | 'in-process' | 'none'
  hasTmux: boolean
  hasITerm2: boolean
  hasIT2: boolean
}

export type PaneCreateOptions = {
  command: string
  name?: string
  color?: string
  cwd?: string
  env?: Record<string, string>
}

export type PaneHandle = {
  id: string
  type: 'tmux' | 'iterm2'
}


export interface HostTaskSystem {
  listTasks(listId: string): Promise<HostTask[]>
  claimTask(listId: string, taskId: string, agentName: string): Promise<{ success: boolean; reason?: string }>
  updateTask(listId: string, taskId: string, updates: Partial<HostTask>): Promise<void>
}

export type HostTask = {
  id: string
  subject: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed'
  owner?: string
  blockedBy: string[]
}


export interface HostUIState {
  updateTask(taskId: string, updater: (task: unknown) => unknown): void
  getAppState(): unknown
}


export interface HostWorktreeManager {
  create(options: { branch: string; path: string; slug: string }): Promise<string>
  remove(path: string): Promise<void>
  validate(path: string): Promise<boolean>
}


export interface HostEnvironment {
  getTeamsDir(): string
  getTeamName(): string | undefined
  getAgentName(): string | undefined
  getAgentColor(): string | undefined
  getSessionId(): string
  isEnabled(feature: string): boolean
}


export interface SwarmHostDeps {
  api: HostApiProvider
  tools: HostToolRegistry
  permissions: HostPermissionGate
  compaction: HostCompaction
  context: HostContextProvider
  session: HostSessionManager
  events: HostEventSink
  hooks: HostHookCallbacks
  fs: HostFileSystem
  terminal?: HostTerminalBackend
  tasks: HostTaskSystem
  ui: HostUIState
  worktree: HostWorktreeManager
  env: HostEnvironment
}
