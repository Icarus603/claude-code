/**
 * MemoryHostBindings — runtime dependencies injected by the composition root.
 *
 * All optional: the memory package works at module load time before the host
 * installs bindings (e.g., for static initializers, test doubles). Every call
 * site uses optional-chaining (binding?.()) so missing bindings are silent
 * no-ops unless documented otherwise.
 *
 * V7 §8 — memory is a Wave 2 leaf. It cannot import from app-compat/agent/
 * provider/app-host. All cross-layer dependencies come through this file.
 */

/** Minimal filesystem interface (subset of FsOperations) */
export type MemFsImplementation = {
  readFileSync(path: string, opts: { encoding: string }): string
  readdir(
    path: string,
  ): Promise<
    Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>
  >
  mkdir(path: string): Promise<void>
}

/** Minimal session candidate for consolidation lock */
export type MemSessionCandidate = {
  sessionId: string
  mtime: number
}

/** Minimal memory file header returned by scanMemoryFiles */
export type MemoryFileHeader = {
  filename: string
  filePath: string
  mtimeMs: number
  description?: string
}

export type MemoryHostBindings = {
  // ── Logging ────────────────────────────────────────────────────────────
  logDebug?: (message: string, metadata?: unknown) => void
  logEvent?: (
    event: string,
    metadata?: Record<string, number | boolean | string>,
  ) => void

  // ── Timestamp ──────────────────────────────────────────────────────────
  now?: () => number

  // ── Session state (bootstrap/state.ts) ────────────────────────────────
  getCwd?: () => string
  getOriginalCwd?: () => string
  getProjectRoot?: () => string | undefined
  getIsNonInteractiveSession?: () => boolean
  getKairosActive?: () => boolean
  getIsRemoteMode?: () => boolean
  getSessionId?: () => string

  // ── Config/paths ───────────────────────────────────────────────────────
  /** Returns ~/.claude (or CLAUDE_CONFIG_DIR override) */
  getConfigHomeDir?: () => string

  // ── Filesystem ─────────────────────────────────────────────────────────
  getFsImplementation?: () => MemFsImplementation
  /** Maps a CWD to the project session directory */
  getProjectDir?: (cwd: string) => string

  // ── Git ────────────────────────────────────────────────────────────────
  findCanonicalGitRoot?: (cwd: string) => string | undefined
  /** Returns "owner/repo" slug for the current git remote, or null */
  getGithubRepo?: () => Promise<string | null>

  // ── Process / session listing ──────────────────────────────────────────
  isProcessRunning?: (pid: number) => boolean
  listCandidates?: (
    dir: string,
    recentOnly: boolean,
  ) => Promise<MemSessionCandidate[]>

  // ── Tool / feature flags ───────────────────────────────────────────────
  isReplModeEnabled?: () => boolean
  hasEmbeddedSearchTools?: () => boolean
  /** The name of the Grep tool as registered in the tool registry */
  grepToolName?: string

  // ── Provider / model ───────────────────────────────────────────────────
  getDefaultSonnetModel?: () => string
  getAPIProvider?: () => string
  isFirstPartyAnthropicBaseUrl?: () => boolean
  getClaudeCodeUserAgent?: () => string
  getRetryDelay?: (attempt: number) => number

  // ── Side-query API ─────────────────────────────────────────────────────
  sideQuery?: (params: {
    model: string
    system: string
    skipSystemPromptPrefix: boolean
    messages: Array<{ role: string; content: string }>
    max_tokens: number
    output_format: unknown
    signal: AbortSignal
    querySource: string
  }) => Promise<{ content: Array<{ type: string; text?: string }> }>

  // ── OAuth / auth ───────────────────────────────────────────────────────
  checkAndRefreshOAuthTokenIfNeeded?: () => Promise<void>
  getClaudeAIOAuthTokens?: () => {
    accessToken?: string
    scopes?: string[]
  } | null
  oauthBaseApiUrl?: string
  oauthBetaHeader?: string
  claudeAiInferenceScope?: string
  claudeAiProfileScope?: string

  // ── Memory file scanning ───────────────────────────────────────────────
  scanMemoryFiles?: (
    memoryDir: string,
    signal: AbortSignal,
  ) => Promise<MemoryFileHeader[]>
  formatMemoryManifest?: (memories: MemoryFileHeader[]) => string
  reportMemoryShapeTelemetry?: (
    all: MemoryFileHeader[],
    selected: MemoryFileHeader[],
  ) => void

  // ── Cache invalidation ─────────────────────────────────────────────────
  clearMemoryFileCaches?: () => void

  // ── Forked agent runner ────────────────────────────────────────────────
  runForkedAgent?: (params: {
    promptMessages: unknown[]
    cacheSafeParams: unknown
    canUseTool: (
      tool: unknown,
      input: Record<string, unknown>,
    ) => Promise<unknown>
    querySource: string
    forkLabel: string
    skipTranscript: boolean
    overrides?: { abortController: AbortController }
    onMessage?: (msg: unknown) => void
    maxTurns?: number
  }) => Promise<{
    messages: unknown[]
    totalUsage: {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens: number
      cache_creation_input_tokens: number
    }
  }>
  createCacheSafeParams?: (context: unknown) => unknown
  createUserMessage?: (params: { content: string }) => unknown
  createMemorySavedMessage?: (filesTouched: string[]) => {
    type: string
    teamCount?: number
    [key: string]: unknown
  }
  createAbortController?: () => AbortController

  // ── Task management (autoDream) ────────────────────────────────────────
  registerDreamTask?: (
    setAppState: unknown,
    params: {
      sessionsReviewing: number
      priorMtime: number
      abortController: AbortController
    },
  ) => string
  addDreamTurn?: (
    taskId: string,
    turn: { text: string; toolUseCount: number },
    paths: string[],
    setAppState: unknown,
  ) => void
  completeDreamTask?: (taskId: string, setAppState: unknown) => void
  failDreamTask?: (taskId: string, setAppState: unknown) => void
  isDreamTask?: (
    state: unknown,
  ) => state is { filesTouched: string[]; status?: string }

  // ── Extraction prompts ─────────────────────────────────────────────────
  buildExtractAutoOnlyPrompt?: (
    newMessageCount: number,
    existingMemories: string,
    skipIndex: boolean,
  ) => string
  buildExtractCombinedPrompt?: (
    newMessageCount: number,
    existingMemories: string,
    skipIndex: boolean,
  ) => string

  // ── Secret scanning (teamMemorySync) ───────────────────────────────────
  scanForSecrets?: (
    content: string,
  ) => Array<{ ruleId: string; label: string }>

  // ── Analytics ─────────────────────────────────────────────────────────
  sanitizeToolNameForAnalytics?: (toolName: string) => string
}
