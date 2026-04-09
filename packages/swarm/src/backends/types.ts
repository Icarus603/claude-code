/**
 * Types of backends available for teammate execution.
 * - 'tmux': Uses tmux for pane management
 * - 'iterm2': Uses iTerm2 native split panes via the it2 CLI
 * - 'in-process': Runs teammate in the same process with isolated context
 */
export type BackendType = 'tmux' | 'iterm2' | 'in-process'

/**
 * Subset of BackendType for pane-based backends only.
 */
export type PaneBackendType = 'tmux' | 'iterm2'

/**
 * Opaque identifier for a pane managed by a backend.
 */
export type PaneId = string

/**
 * Result of creating a new teammate pane.
 */
export type CreatePaneResult = {
  paneId: PaneId
  isFirstTeammate: boolean
}

/**
 * Type guard to check if a backend type uses terminal panes.
 */
export function isPaneBackend(type: BackendType): type is PaneBackendType {
  return type === 'tmux' || type === 'iterm2'
}

/**
 * Interface for pane management backends.
 */
export type PaneBackend = {
  readonly type: BackendType
  readonly displayName: string
  readonly supportsHideShow: boolean
  isAvailable(): Promise<boolean>
  isRunningInside(): Promise<boolean>
  createTeammatePaneInSwarmView(
    name: string,
    color: string,
  ): Promise<CreatePaneResult>
  sendCommandToPane(
    paneId: PaneId,
    command: string,
    useExternalSession?: boolean,
  ): Promise<void>
  setPaneBorderColor(
    paneId: PaneId,
    color: string,
    useExternalSession?: boolean,
  ): Promise<void>
  setPaneTitle(
    paneId: PaneId,
    name: string,
    color: string,
    useExternalSession?: boolean,
  ): Promise<void>
  enablePaneBorderStatus(
    windowTarget?: string,
    useExternalSession?: boolean,
  ): Promise<void>
  rebalancePanes(windowTarget: string, hasLeader: boolean): Promise<void>
  killPane(paneId: PaneId, useExternalSession?: boolean): Promise<boolean>
  hidePane(paneId: PaneId, useExternalSession?: boolean): Promise<boolean>
  showPane(
    paneId: PaneId,
    targetWindowOrPane: string,
    useExternalSession?: boolean,
  ): Promise<boolean>
}

export type BackendDetectionResult = {
  backend: PaneBackend
  isNative: boolean
  needsIt2Setup?: boolean
}

export type TeammateIdentity = {
  name: string
  teamName: string
  color?: string
  planModeRequired?: boolean
}

export type TeammateSpawnConfig = TeammateIdentity & {
  prompt: string
  cwd: string
  model?: string
  systemPrompt?: string
  systemPromptMode?: 'default' | 'replace' | 'append'
  worktreePath?: string
  parentSessionId: string
  permissions?: string[]
  allowPermissionPrompts?: boolean
}

export type TeammateSpawnResult = {
  success: boolean
  agentId: string
  error?: string
  abortController?: AbortController
  taskId?: string
  paneId?: PaneId
}

export type TeammateMessage = {
  text: string
  from: string
  color?: string
  timestamp?: string
  summary?: string
}

export type TeammateExecutor = {
  readonly type: BackendType
  isAvailable(): Promise<boolean>
  spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult>
  sendMessage(agentId: string, message: TeammateMessage): Promise<void>
  terminate(agentId: string, reason?: string): Promise<boolean>
  kill(agentId: string): Promise<boolean>
  isActive(agentId: string): Promise<boolean>
}
