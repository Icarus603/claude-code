/**
 * Per-worker classifier state — ant 3921.js _LH writes this shape to
 * each worker's state.json sidecar. Daemon list / hub UI reads it.
 *
 * @dynamicRequire
 */

export type WorkerState = 'idle' | 'working' | 'blocked' | 'done' | 'failed' | 'crashed' | 'stopped'
export type WorkerTempo = 'active' | 'idle' | 'blocked'

export interface ClassifierResult {
  state: WorkerState
  detail: string
  tempo: WorkerTempo
  needs?: string
  output?: Record<string, string>
  /** 'preclassify' | 'heuristic' | 'llm' | 'apiError' — provenance. */
  source: 'preclassify' | 'heuristic' | 'llm' | 'apiError'
  /** Inner-classifier 'branch' string (which regex / LLM path). */
  branch?: string
}

export interface WorkerStateFile {
  /** Current state. */
  state: WorkerState
  /** One-line detail (lock-screen text). */
  detail: string
  /** Tempo: active/idle/blocked. */
  tempo: WorkerTempo
  /** Set when blocked: what user must do. */
  needs?: string
  /** Optional structured outputs (e.g. {result: "..."}). */
  output?: Record<string, string>
  /** Last classifier source ('preclassify' / 'heuristic' / 'llm'). */
  classifySource?: ClassifierResult['source']
  /** First time we saw a terminal state (done/failed/crashed). */
  firstTerminalAt?: string
  /** Created timestamp (ISO). */
  createdAt: string
  /** Last update timestamp (ISO). */
  updatedAt: string
  /** Originating session id. */
  sessionId?: string
  /** Resume session id (post-restart). */
  resumeSessionId?: string
  /** ccb version that classified. */
  cliVersion?: string
  /** Worker cwd. */
  cwd: string
  /** User's original directive (intent). */
  intent?: string
  /** First user prompt verbatim. */
  initialPrompt?: string
  /** Symbolic agent name (slug). */
  name?: string
  /** Where name came from ('user' | 'llm-summarize'). */
  nameSource?: string
  /** ant 3921.js — backend always 'daemon' for ccb. */
  backend?: string
  /** Token budget so far. */
  tokens?: {
    input: number
    output: number
    cacheRead: number
    cacheCreation: number
  }
}

/** Constants from ant 3918.js. */
export const TERMINAL_STATES: ReadonlySet<WorkerState> = new Set([
  'done',
  'failed',
  'stopped',
  'crashed',
])

export function isTerminalState(s: string | undefined): boolean {
  return s !== undefined && TERMINAL_STATES.has(s as WorkerState)
}

/** Truncate text to MAX_DETAIL_CHARS (ant PM = 800). */
export const MAX_DETAIL_CHARS = 800
/** Tail size fed to LLM (ant am7 = 2000). */
export const LLM_TAIL_CHARS = 2000

export function truncate(s: string, max: number = MAX_DETAIL_CHARS): string {
  if (s.length <= max) return s
  let q = max - 1
  // Don't split surrogate pair (ant up5).
  const code = s.charCodeAt(q - 1)
  if (code >= 55296 && code <= 56319) q--
  return s.slice(0, q) + '\u2026'
}
