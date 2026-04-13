/**
 * Local structural type aliases for the memory package.
 *
 * These replace direct type imports from app-compat which
 * violate V7 Wave 2 boundaries. The types here are minimal structural
 * equivalents — callers in the integration layer (app-compat/agent) satisfy
 * them via TypeScript's structural typing without explicit casts.
 *
 * V7 §8 — memory cannot import types from app-compat. Local structurals are
 * the approved substitution pattern.
 */

// ── Message types ─────────────────────────────────────────────────────────────

/** Minimal message shape needed by extractMemories / autoDream */
export type MemMessage = {
  type: string
  uuid?: string
  message?: {
    content: Array<MemContentBlock>
  }
  [key: string]: unknown
}

export type MemContentBlock = {
  type: string
  name?: string
  input?: unknown
  text?: string
}

/** Structural slice of AssistantMessage content */
export type MemAssistantMessage = MemMessage & {
  type: 'assistant'
  message: { content: MemContentBlock[] }
}

// ── System message (for appendSystemMessage callback) ──────────────────────────

export type MemSystemMessage = {
  type: string
  [key: string]: unknown
}

// ── Tool types ────────────────────────────────────────────────────────────────

/** Minimal structural slice of Tool needed by extractMemories */
export type MemTool = {
  name: string
  inputSchema: {
    safeParse: (input: unknown) => { success: boolean; data: unknown }
  }
  isReadOnly?: (input: unknown) => boolean
}

/** Permission result returned by canUseTool */
export type MemToolPermissionResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | {
      behavior: 'deny'
      message: string
      decisionReason: { type: string; reason?: string }
    }

/** The canUseTool function signature used by forked agents */
export type MemCanUseTool = (
  tool: MemTool,
  input: Record<string, unknown>,
) => Promise<MemToolPermissionResult>

// ── REPL hook context ─────────────────────────────────────────────────────────

/** Structural slice of AppState needed by memory package */
export type MemAppState = {
  tasks?: Record<string, unknown>
  [key: string]: unknown
}

/** Structural slice of ToolUseContext needed by memory package */
export type MemToolUseContext = {
  agentId?: string
  setAppState: (f: (prev: MemAppState) => MemAppState) => void
  setAppStateForTasks?: (f: (prev: MemAppState) => MemAppState) => void
  getAppState: () => MemAppState
  appendSystemMessage?: (msg: MemSystemMessage) => void
}

/** Structural equivalent of REPLHookContext for memory package usage */
export type MemREPLContext = {
  messages: MemMessage[]
  toolUseContext: MemToolUseContext
}

// ── SetAppState ───────────────────────────────────────────────────────────────

export type MemSetAppState = (f: (prev: MemAppState) => MemAppState) => void
