
import type { CoreMessage, Usage } from './messages.js'
import type {
  CompactionResult,
  CompactionContext,
  PostCompactCleanupActions,
  ToolNameConstants,
  TokenWarningState,
} from './compaction.js'

// ── Feature Flag ──

export interface FeatureFlagDep {
  isEnabled(flag: string): boolean
}

// ── Config ──

export interface ConfigDep {
  getAutoCompactEnabled(): boolean
  getSdkBetas(): string[]
  getEnv(key: string): string | undefined
}

// ── Model ──

export interface ModelDep {
  getContextWindowSize(model: string, betas: string[]): number
  getMaxOutputTokensForModel(model: string): number
  getMainLoopModel(): string
}

// ── Token ──

export interface TokenDep {
  estimateTokens(messages: CoreMessage[]): number
  tokensFromLastAPIResponse(messages: CoreMessage[]): number | undefined
  roughEstimate(content: string): number
  roughEstimateForMessages(messages: CoreMessage[]): number
}

// ── Analytics ──

export interface AnalyticsDep {
  logEvent(name: string, metadata: Record<string, unknown>): void
  getFeatureValue<T>(key: string, defaultValue: T): T
  getDynamicConfig<T>(key: string, defaultValue: T): Promise<T>
}

// ── API ──

export interface ApiDep {
  streamCompactSummary(params: {
    messages: CoreMessage[]
    summaryRequest: CoreMessage
    context: unknown
  }): Promise<CoreMessage>
  getPromptTooLongTokenGap(response: CoreMessage): number | undefined
  startsWithApiErrorPrefix(text: string): boolean
  notifyCompaction(source: string, agentId?: string): void
  notifyCacheDeletion(source: string): void
}

// ── Messages ──

export interface MessagesDep {
  createCompactBoundaryMessage(
    trigger: string,
    preTokenCount: number,
    lastUuid?: string,
    userFeedback?: string,
    messagesSummarized?: number,
  ): CoreMessage
  createUserMessage(params: Record<string, unknown>): CoreMessage
  getAssistantMessageText(message: CoreMessage): string | null
  getLastAssistantMessage(messages: CoreMessage[]): CoreMessage | null
  getMessagesAfterCompactBoundary(messages: CoreMessage[]): CoreMessage[]
  isCompactBoundaryMessage(message: CoreMessage): boolean
  normalizeMessagesForAPI(messages: CoreMessage[], tools: unknown[]): CoreMessage[]
}

// ── Attachments ──

export interface AttachmentsDep {
  stripImagesFromMessages(messages: CoreMessage[]): CoreMessage[]
  stripReinjectedAttachments(messages: CoreMessage[]): CoreMessage[]
  createAttachmentMessage(attachment: unknown): CoreMessage
  generateFileAttachment(
    filename: string,
    context: unknown,
    successEvent: string,
    errorEvent: string,
    source: string,
  ): Promise<unknown | null>
  getDeferredToolsDeltaAttachment(
    tools: unknown[],
    model: string,
    messages: CoreMessage[],
    options: { callSite: string },
  ): unknown[]
  getAgentListingDeltaAttachment(context: unknown, messages: CoreMessage[]): unknown[]
  getMcpInstructionsDeltaAttachment(
    mcpClients: unknown[],
    tools: unknown[],
    model: string,
    messages: CoreMessage[],
  ): unknown[]
}

// ── Hooks ──

export interface HooksDep {
  executePreCompactHooks(
    params: { trigger: string; customInstructions: string | null },
    signal: AbortSignal,
  ): Promise<{ newCustomInstructions?: string; userDisplayMessage?: string }>
  executePostCompactHooks(
    params: { trigger: string; compactSummary: string },
    signal: AbortSignal,
  ): Promise<{ userDisplayMessage?: string }>
  processSessionStartHooks(source: string, options: { model: string }): Promise<CoreMessage[]>
}

// ── State ──

export interface StateDep {
  markPostCompaction(): void
  setLastSummarizedMessageId(id: string | undefined): void
  getLastSummarizedMessageId(): string | undefined
}

// ── Session Memory ──

export interface SessionMemoryDep {
  isSessionMemoryEmpty(content: string): Promise<boolean>
  truncateSessionMemoryForCompact(content: string): { truncatedContent: string; wasTruncated: boolean }
  getSessionMemoryContent(): Promise<string | null>
  waitForSessionMemoryExtraction(): Promise<void>
  getSessionMemoryPath(): string
}

// ── Session Storage ──

export interface SessionStorageDep {
  getTranscriptPath(): string
  reAppendSessionMetadata(): void
  clearSessionMessagesCache(): void
}

// ── Plans ──

export interface PlansDep {
  getPlan(agentId?: string): string | null
  getPlanFilePath(agentId?: string): string
}

// ── Skills ──

export interface SkillsDep {
  getInvokedSkillsForAgent(agentId?: string): Map<string, { skillName: string; skillPath: string; content: string; invokedAt: number }>
}

// ── Tool Search ──

export interface ToolSearchDep {
  isToolSearchEnabled(
    model: string,
    tools: unknown[],
    getPermissions: () => Promise<unknown>,
    agents: unknown,
    source: string,
  ): Promise<boolean>
  extractDiscoveredToolNames(messages: CoreMessage[]): Set<string>
}

// ── Fork ──

export interface ForkDep {
  runForkedAgent(params: {
    promptMessages: CoreMessage[]
    cacheSafeParams: unknown
    canUseTool: () => Promise<{ behavior: string; message: string }>
    querySource: string
    forkLabel: string
    maxTurns: number
    skipCacheWrite: boolean
    overrides?: { abortController: AbortController }
  }): Promise<{
    messages: CoreMessage[]
    totalUsage: Usage & { cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  }>
}

// ── Activity ──

export interface ActivityDep {
  isSessionActivityTrackingActive(): boolean
  sendSessionActivitySignal(): void
}

// ── Transcript ──

export interface TranscriptDep {
  writeSessionTranscriptSegment(messages: CoreMessage[]): void
}

// ── Context Cleanup ──

export interface ContextCleanupDep {
  clearUserContextCache(): void
  resetMemoryFilesCache(source: string): void
}


export interface CompactionDeps {
  featureFlags: FeatureFlagDep
  config: ConfigDep
  model: ModelDep
  tokens: TokenDep
  analytics: AnalyticsDep
  api: ApiDep
  messages: MessagesDep
  attachments: AttachmentsDep
  hooks: HooksDep
  state: StateDep
  sessionMemory: SessionMemoryDep
  sessionStorage: SessionStorageDep
  plans: PlansDep
  skills: SkillsDep
  toolSearch: ToolSearchDep
  fork: ForkDep
  activity: ActivityDep
  transcript: TranscriptDep
  contextCleanup: ContextCleanupDep
  postCompactCleanup: PostCompactCleanupActions
  toolNames: ToolNameConstants
}
