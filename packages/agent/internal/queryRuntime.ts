import { randomUUID } from 'crypto'
import { getAgentHostBindings } from '../host.js'
import type { AgentMessage, AgentToolUseContext } from '../internalTypes.js'

type DynamicAgentBindings = ReturnType<typeof getAgentHostBindings> &
  Record<string, unknown>

type ErrorConstructor<T extends Error> = abstract new (...args: never[]) => T

export type FallbackTriggeredErrorLike = Error & {
  originalModel: string
  fallbackModel: string
}

export type StreamingToolExecutorResult = {
  message?: AgentMessage
  newContext?: AgentToolUseContext
}

export type StreamingToolExecutorLike = {
  addTool: (toolUse: unknown, assistantMessage: unknown) => void
  discard: () => void
  getCompletedResults: () => StreamingToolExecutorResult[]
  getRemainingResults: () => AsyncGenerator<StreamingToolExecutorResult>
}

export type MemoryPrefetchHandle = Disposable & {
  settledAt: number | null
  consumedOnIteration: number
  promise: Promise<Array<{ type: string; [key: string]: unknown }>>
}

type SnipCompactResult = {
  messages: AgentMessage[]
  tokensFreed: number
  boundaryMessage?: AgentMessage
}

type ContextCollapseApplyResult = {
  messages: AgentMessage[]
}

type ContextCollapseRecoveryResult = {
  messages: AgentMessage[]
  committed: number
}

function getBindings(): DynamicAgentBindings {
  return getAgentHostBindings() as DynamicAgentBindings
}

function getErrorConstructor<T extends Error>(
  key: string,
): ErrorConstructor<T> | undefined {
  const value = getBindings()[key]
  if (typeof value === 'function') {
    try {
      return (value as () => ErrorConstructor<T> | undefined)()
    } catch {
      return undefined
    }
  }
  return value as ErrorConstructor<T> | undefined
}

const EMPTY_MEMORY_PREFETCH: MemoryPrefetchHandle = {
  settledAt: Date.now(),
  consumedOnIteration: -1,
  promise: Promise.resolve([]),
  [Symbol.dispose]() {},
}

export function isFallbackTriggeredError(
  error: unknown,
): error is FallbackTriggeredErrorLike {
  const Ctor =
    getErrorConstructor<FallbackTriggeredErrorLike>('fallbackTriggeredErrorCtor')
  return Boolean(Ctor && error instanceof Ctor)
}

export function isImageTransformError(error: unknown): error is Error {
  const sizeCtor = getErrorConstructor<Error>('imageSizeErrorCtor')
  const resizeCtor = getErrorConstructor<Error>('imageResizeErrorCtor')
  return Boolean(
    (sizeCtor && error instanceof sizeCtor) ||
      (resizeCtor && error instanceof resizeCtor),
  )
}

export function getPromptTooLongErrorMessage(): string {
  return (getBindings().promptTooLongErrorMessage as string | undefined) ?? ''
}

export function isPromptTooLongMessage(message: unknown): boolean {
  return getBindings().isPromptTooLongMessage?.(message) === true
}

export function normalizeMessagesForAPI(
  messages: AgentMessage[],
  tools: unknown[],
): AgentMessage[] {
  return (
    getBindings().normalizeMessagesForAPI?.(messages, tools) as
      | AgentMessage[]
      | undefined
  ) ?? messages
}

export function getMessagesAfterCompactBoundary(
  messages: AgentMessage[],
): AgentMessage[] {
  return (
    getBindings().getMessagesAfterCompactBoundary?.(messages) as
      | AgentMessage[]
      | undefined
  ) ?? messages
}

export function stripSignatureBlocks(messages: AgentMessage[]): AgentMessage[] {
  return (
    getBindings().stripSignatureBlocks?.(messages) as AgentMessage[] | undefined
  ) ?? messages
}

export function generateToolUseSummary(params: unknown): Promise<string | null> {
  return (
    getBindings().generateToolUseSummary?.(params) as
      | Promise<string | null>
      | undefined
  ) ?? Promise.resolve(null)
}

export function prependUserContext(
  messages: AgentMessage[],
  userContext: Record<string, string>,
): AgentMessage[] {
  return (
    getBindings().prependUserContext?.(messages, userContext) as
      | AgentMessage[]
      | undefined
  ) ?? messages
}

export function appendSystemContext(
  systemPrompt: readonly string[],
  systemContext: Record<string, string>,
): readonly string[] {
  return (
    getBindings().appendSystemContext?.(systemPrompt, systemContext) as
      | readonly string[]
      | undefined
  ) ?? systemPrompt
}

export function createAttachmentMessage(attachment: {
  type: string
  [key: string]: unknown
}): AgentMessage {
  return (
    getBindings().createAttachmentMessage?.(attachment) as
      | AgentMessage
      | undefined
  ) ?? {
    type: 'attachment',
    attachment,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}

export function filterDuplicateMemoryAttachments(
  attachments: Array<{ type: string; [key: string]: unknown }>,
  readFileState: unknown,
): Array<{ type: string; [key: string]: unknown }> {
  return (
    getBindings().filterDuplicateMemoryAttachments?.(
      attachments,
      readFileState,
    ) as Array<{ type: string; [key: string]: unknown }> | undefined
  ) ?? attachments
}

export function getAttachmentMessages(
  appendedMessage: unknown,
  toolUseContext: AgentToolUseContext,
  permissionsMessage: unknown,
  queuedCommands: unknown[],
  messages: AgentMessage[],
  querySource: string,
): AsyncGenerator<AgentMessage> {
  return (
    getBindings().getAttachmentMessages?.(
      appendedMessage,
      toolUseContext,
      permissionsMessage,
      queuedCommands,
      messages,
      querySource,
    ) as AsyncGenerator<AgentMessage> | undefined
  ) ?? (async function* () {})()
}

export function startRelevantMemoryPrefetch(
  messages: AgentMessage[],
  toolUseContext: AgentToolUseContext,
): MemoryPrefetchHandle {
  return (
    getBindings().startRelevantMemoryPrefetch?.(
      messages,
      toolUseContext,
    ) as MemoryPrefetchHandle | undefined
  ) ?? EMPTY_MEMORY_PREFETCH
}

export function startSkillDiscoveryPrefetch(
  pivot: unknown,
  messages: AgentMessage[],
  toolUseContext: AgentToolUseContext,
): unknown {
  return getBindings().startSkillDiscoveryPrefetch?.(
    pivot,
    messages,
    toolUseContext,
  )
}

export function collectSkillDiscoveryPrefetch(
  pending: unknown,
): Promise<Array<{ type: string; [key: string]: unknown }>> {
  return (
    getBindings().collectSkillDiscoveryPrefetch?.(pending) as
      | Promise<Array<{ type: string; [key: string]: unknown }>>
      | undefined
  ) ?? Promise.resolve([])
}

export function getRuntimeMainLoopModel(params: unknown): string {
  return (getBindings().getRuntimeMainLoopModel?.(params) as string | undefined) ?? ''
}

export function renderModelName(model: string): string {
  return (getBindings().renderModelName?.(model) as string | undefined) ?? model
}

export function doesMostRecentAssistantMessageExceed200k(
  messages: AgentMessage[],
): boolean {
  return (
    getBindings().doesMostRecentAssistantMessageExceed200k?.(messages) === true
  )
}

export function finalContextTokensFromLastResponse(
  messages: AgentMessage[],
): number {
  return (
    getBindings().finalContextTokensFromLastResponse?.(messages) as
      | number
      | undefined
  ) ?? 0
}

export function tokenCountWithEstimation(messages: AgentMessage[]): number {
  return (
    getBindings().tokenCountWithEstimation?.(messages) as number | undefined
  ) ?? 0
}

export function getEscalatedMaxTokens(): number {
  return (
    getBindings().escalatedMaxTokens as number | undefined
  ) ?? 64000
}

export function getContextWindowForModel(model: string): number {
  return (
    getBindings().getContextWindowForModel?.(model) as number | undefined
  ) ?? 0
}

export function executePostSamplingHooks(
  messages: AgentMessage[],
  systemPrompt: readonly string[],
  userContext: Record<string, string>,
  systemContext: Record<string, string>,
  toolUseContext: AgentToolUseContext,
  querySource: string,
): void {
  getBindings().executePostSamplingHooks?.(
    messages,
    systemPrompt,
    userContext,
    systemContext,
    toolUseContext,
    querySource,
  )
}

export function executeStopFailureHooks(
  message: AgentMessage,
  toolUseContext: AgentToolUseContext,
): void {
  getBindings().executeStopFailureHooks?.(message, toolUseContext)
}

export function createStreamingToolExecutor(
  tools: unknown[],
  canUseTool: unknown,
  toolUseContext: AgentToolUseContext,
): StreamingToolExecutorLike | null {
  return (
    getBindings().createStreamingToolExecutor?.(
      tools,
      canUseTool,
      toolUseContext,
    ) as StreamingToolExecutorLike | undefined
  ) ?? null
}

export function runTools(
  toolUseBlocks: unknown[],
  assistantMessages: AgentMessage[],
  canUseTool: unknown,
  toolUseContext: AgentToolUseContext,
): AsyncGenerator<StreamingToolExecutorResult> {
  return (
    getBindings().runTools?.(
      toolUseBlocks,
      assistantMessages,
      canUseTool,
      toolUseContext,
    ) as AsyncGenerator<StreamingToolExecutorResult> | undefined
  ) ?? (async function* () {})()
}

export function applyToolResultBudget(
  messages: AgentMessage[],
  contentReplacementState: unknown,
  persist: ((records: unknown[]) => void) | undefined,
  toolNamesWithoutBudget: Set<string>,
): Promise<AgentMessage[]> {
  return (
    getBindings().applyToolResultBudget?.(
      messages,
      contentReplacementState,
      persist,
      toolNamesWithoutBudget,
    ) as Promise<AgentMessage[]> | undefined
  ) ?? Promise.resolve(messages)
}

export function snipCompactIfNeededWithMetadata(
  messages: AgentMessage[],
): SnipCompactResult {
  return (
    getBindings().snipCompactWithMetadata?.(messages) as
      | SnipCompactResult
      | undefined
  ) ?? { messages, tokensFreed: 0 }
}

export function applyContextCollapsesIfNeeded(
  messages: AgentMessage[],
  toolUseContext: AgentToolUseContext,
  querySource: string,
): Promise<ContextCollapseApplyResult> {
  return (
    getBindings().applyContextCollapsesIfNeeded?.(
      messages,
      toolUseContext,
      querySource,
    ) as Promise<ContextCollapseApplyResult> | undefined
  ) ?? Promise.resolve({ messages })
}

export function recoverContextCollapseOverflow(
  messages: AgentMessage[],
  querySource: string,
): ContextCollapseRecoveryResult {
  return (
    getBindings().recoverContextCollapseOverflow?.(
      messages,
      querySource,
    ) as ContextCollapseRecoveryResult | undefined
  ) ?? { messages, committed: 0 }
}

export function isContextCollapseEnabled(): boolean {
  return getBindings().isContextCollapseEnabled?.() === true
}

export function isWithheldContextCollapsePromptTooLong(
  message: AgentMessage,
  querySource: string,
): boolean {
  return (
    getBindings().isWithheldContextCollapsePromptTooLong?.(
      message,
      querySource,
    ) === true
  )
}

export function isReactiveCompactEnabled(): boolean {
  return getBindings().isReactiveCompactEnabled?.() === true
}

export function isWithheldReactivePromptTooLong(message: AgentMessage): boolean {
  return getBindings().isWithheldReactivePromptTooLong?.(message) === true
}

export function isWithheldReactiveMediaSizeError(
  message: AgentMessage,
): boolean {
  return getBindings().isWithheldReactiveMediaSizeError?.(message) === true
}

export function tryReactiveCompact(params: unknown): Promise<unknown> {
  return (
    getBindings().tryReactiveCompact?.(params) as Promise<unknown> | undefined
  ) ?? Promise.resolve(undefined)
}

export function cleanupComputerUseAfterTurn(
  toolUseContext: AgentToolUseContext,
): Promise<void> {
  return (
    getBindings().cleanupComputerUseAfterTurn?.(toolUseContext) as
      | Promise<void>
      | undefined
  ) ?? Promise.resolve()
}

export function shouldGenerateTaskSummary(): boolean {
  return getBindings().shouldGenerateTaskSummary?.() === true
}

export function maybeGenerateTaskSummary(params: unknown): void {
  getBindings().maybeGenerateTaskSummary?.(params)
}
