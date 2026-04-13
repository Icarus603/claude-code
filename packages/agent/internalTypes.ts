/**
 * Local structural type aliases for the agent package.
 *
 * These replace direct type imports from app-compat that violate V7
 * boundaries. The types here are minimal structural equivalents — callers
 * in the integration layer (app-compat/agent) satisfy them via TypeScript's
 * structural typing without explicit casts.
 *
 * V7 §8 — agent cannot import types from app-compat. Local structurals are
 * the approved substitution pattern.
 */

// ── Message types ──────────────────────────────────────────────────────────────

/** Minimal message shape used by stop hooks and query loop */
export type AgentMessage = {
  type: string
  uuid?: string
  isApiErrorMessage?: boolean
  message?: {
    content: unknown[]
    usage?: { [key: string]: number }
  }
  [key: string]: unknown
}

export type AgentAssistantMessage = AgentMessage & {
  type: 'assistant'
  message: { content: unknown[]; usage?: { [key: string]: number } }
}

export type AgentStreamEvent = {
  type: string
  [key: string]: unknown
}

export type AgentRequestStartEvent = {
  type: 'stream_request_start'
}

export type AgentTombstoneMessage = {
  type: 'tombstone'
  message: AgentMessage
}

export type AgentToolUseSummaryMessage = {
  type: 'tool_use_summary'
  [key: string]: unknown
}

// ── Hook types ─────────────────────────────────────────────────────────────────

/** Minimal hook progress data shape */
export type AgentHookProgress = {
  command?: string
  promptText?: string
  [key: string]: unknown
}

/** Minimal stop hook info */
export type AgentStopHookInfo = {
  command: string
  promptText?: string
  durationMs?: number
}

/** Result yielded by hook execution generators */
export type AgentHookResult = {
  message?: AgentMessage
  blockingError?: { blockingError: string }
  preventContinuation?: boolean
  stopReason?: string
  [key: string]: unknown
}

// ── Tool / Context types ───────────────────────────────────────────────────────

/** Minimal ToolUseContext shape needed by stop hooks and query loop */
export type AgentToolUseContext = {
  agentId?: string
  agentType?: string
  abortController: AbortController
  getAppState: () => { toolPermissionContext: { mode: string }; [key: string]: unknown }
  setAppState?: (f: (prev: unknown) => unknown) => void
  addNotification?: (n: { key: string; text: string; priority: string }) => void
  queryTracking?: { chainId: string; depth: number }
  appendSystemMessage?: (msg: unknown) => void
  options: {
    mainLoopModel: string
    tools: unknown[]
    isNonInteractiveSession?: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

// ── System prompt type ─────────────────────────────────────────────────────────

/** Minimal SystemPrompt shape */
export type AgentSystemPrompt = Array<{ content: unknown }>

// ── Query source ───────────────────────────────────────────────────────────────

/** Query source identifier — matches the string union in app-compat */
export type AgentQuerySource = string

// ── REPL hook context ──────────────────────────────────────────────────────────

/** Structural equivalent of REPLHookContext for the agent package */
export type AgentREPLHookContext = {
  messages: AgentMessage[]
  systemPrompt: AgentSystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: AgentToolUseContext
  querySource: AgentQuerySource
}

// ── Task types ─────────────────────────────────────────────────────────────────

/** Minimal task shape used by stop hooks */
export type AgentTask = {
  id: string
  status: string
  owner?: string
  subject?: string
  description?: string
  [key: string]: unknown
}

// ── Log option type (for file history) ────────────────────────────────────────

/** Minimal LogOption shape needed by fileHistoryCore */
export type AgentLogOption = {
  messages: Array<{ sessionId?: string; [key: string]: unknown }>
  fileHistorySnapshots?: unknown[]
  [key: string]: unknown
}

// ── Analytics metadata branding ───────────────────────────────────────────────

/**
 * Branded type used for values passed to logEvent to confirm they are not
 * code or filepaths. Matches the app-compat definition (never) so values
 * of this type can only be assigned via explicit cast.
 */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never
