import type {
  AgentHookResult,
  AgentLogOption,
  AgentMessage,
  AgentREPLHookContext,
  AgentStopHookInfo,
  AgentTask,
  AgentToolUseContext,
} from './internalTypes.js'

// ── Filesystem abstraction ─────────────────────────────────────────────────────

/** Minimal filesystem abstraction needed by cronTasksCore */
export type AgentFsImplementation = {
  readFile(path: string, options: { encoding: BufferEncoding }): Promise<string>
  [key: string]: unknown
}

// ── Session cron task ──────────────────────────────────────────────────────────

/** In-memory (session-only) cron task — mirrors bootstrap/state.SessionCronTask */
export type AgentSessionCronTask = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  recurring?: boolean
  agentId?: string
}

// ── File history types ─────────────────────────────────────────────────────────

/** Minimal file history snapshot shape for binding signatures */
export type AgentFileHistorySnapshot = {
  messageId: string
  trackedFileBackups: Record<string, unknown>
  timestamp: Date
  [key: string]: unknown
}

// ── Host bindings ──────────────────────────────────────────────────────────────

export type AgentHostBindings = {
  // ── Observability ────────────────────────────────────────────────────────────
  logDebug?: (message: string, metadata?: unknown) => void
  logEvent?: (event: string, metadata?: Record<string, number | boolean | string>) => void
  logError?: (err: unknown) => void
  logAntError?: (message: string, err: unknown) => void

  // ── Session state ────────────────────────────────────────────────────────────
  getProjectRoot?: () => string
  getSessionId?: () => string
  getOriginalCwd?: () => string
  getIsNonInteractiveSession?: () => boolean
  isSessionPersistenceDisabled?: () => boolean

  // ── Cron session state ───────────────────────────────────────────────────────
  getScheduledTasksEnabled?: () => boolean
  setScheduledTasksEnabled?: (enabled: boolean) => void
  getSessionCronTasks?: () => AgentSessionCronTask[]
  addSessionCronTask?: (task: AgentSessionCronTask) => void
  removeSessionCronTasks?: (ids: readonly string[]) => number

  // ── Config / environment ─────────────────────────────────────────────────────
  getClaudeConfigHomeDir?: () => string

  // ── Process utilities ────────────────────────────────────────────────────────
  isProcessRunning?: (pid: number) => boolean
  registerCleanup?: (fn: () => Promise<void>) => () => void

  // ── Filesystem ───────────────────────────────────────────────────────────────
  getFsImplementation?: () => AgentFsImplementation

  // ── Storage ──────────────────────────────────────────────────────────────────
  recordFileHistorySnapshot?: (
    messageId: string,
    snapshot: AgentFileHistorySnapshot,
    isSnapshotUpdate: boolean,
  ) => Promise<void>

  // ── VSCode integration ────────────────────────────────────────────────────────
  notifyVscodeFileUpdated?: (
    filePath: string,
    oldContent: string | null,
    newContent: string | null,
  ) => void

  // ── Stop hooks ────────────────────────────────────────────────────────────────
  executeStopHooks?: (
    permissionMode?: string,
    signal?: AbortSignal,
    timeoutMs?: number,
    stopHookActive?: boolean,
    subagentId?: string,
    toolUseContext?: AgentToolUseContext,
    messages?: AgentMessage[],
    agentType?: string,
  ) => AsyncGenerator<AgentHookResult>

  executeTaskCompletedHooks?: (
    taskId: string,
    taskSubject?: string,
    taskDescription?: string,
    agentName?: string,
    teamName?: string,
    permissionMode?: string,
    signal?: AbortSignal,
    timeoutMs?: number,
    toolUseContext?: AgentToolUseContext,
  ) => AsyncGenerator<AgentHookResult>

  executeTeammateIdleHooks?: (
    agentName?: string,
    teamName?: string,
    permissionMode?: string,
    signal?: AbortSignal,
  ) => AsyncGenerator<AgentHookResult>

  executeStopFailureHooks?: (
    message: AgentMessage,
    toolUseContext: AgentToolUseContext,
  ) => void

  getStopHookMessage?: (blockingError: { blockingError: string }) => string
  getTaskCompletedHookMessage?: (blockingError: { blockingError: string }) => string
  getTeammateIdleHookMessage?: (blockingError: { blockingError: string }) => string

  // ── Message creators ──────────────────────────────────────────────────────────
  createAttachmentMessage?: (attachment: { type: string; [key: string]: unknown }) => AgentMessage
  createStopHookSummaryMessage?: (
    hookCount: number,
    hookInfos: AgentStopHookInfo[],
    hookErrors: string[],
    preventedContinuation: boolean,
    stopReason: string,
    hasOutput: boolean,
    style: string,
    toolUseID: string,
  ) => AgentMessage
  createSystemMessage?: (content: string, level?: string) => AgentMessage
  createUserInterruptionMessage?: (opts: { toolUse: boolean }) => AgentMessage
  createUserMessage?: (opts: { content: string; isMeta?: boolean }) => AgentMessage

  // ── Teammate context ───────────────────────────────────────────────────────────
  isTeammate?: () => boolean
  getAgentName?: () => string | undefined
  getTeamName?: () => string | undefined

  // ── Task management ────────────────────────────────────────────────────────────
  getTaskListId?: () => string | undefined
  listTasks?: (taskListId: string | undefined) => Promise<AgentTask[]>

  // ── UI ─────────────────────────────────────────────────────────────────────────
  getShortcutDisplay?: (action: string, context: string, fallback: string) => string

  // ── Cache / context ────────────────────────────────────────────────────────────
  createCacheSafeParams?: (ctx: AgentREPLHookContext) => unknown
  saveCacheSafeParams?: (params: unknown) => void

  // ── Features ────────────────────────────────────────────────────────────────────
  executePromptSuggestion?: (ctx: AgentREPLHookContext) => void
  classifyJobState?: (jobDir: string, messages: AgentMessage[]) => Promise<void>

  // ── Computer use (CHICAGO_MCP) ────────────────────────────────────────────────
  cleanupComputerUseAfterTurn?: (toolUseContext: AgentToolUseContext) => Promise<void>

  // ── Token budget (query loop) ─────────────────────────────────────────────────
  getCurrentTurnTokenBudget?: () => number
  getTurnOutputTokens?: () => number
  incrementBudgetContinuationCount?: () => void

  // ── Timing ───────────────────────────────────────────────────────────────────
  now?: () => number
}
