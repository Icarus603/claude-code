import type {
  BetaJSONOutputFormat,
  BetaMessageDeltaUsage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
  BetaUsage,
  BetaMessageParam as MessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Stream } from '@anthropic-ai/sdk/streaming.mjs'
import type { ClientOptions } from '@anthropic-ai/sdk'
import type {
  ProviderAgentDefinition,
  ProviderAgentId,
  ProviderAssistantMessage,
  ProviderEffortValue,
  ProviderMessage,
  ProviderNotification,
  ProviderQueryChainTracking,
  ProviderQuerySource,
  ProviderStreamEvent,
  ProviderSystemAPIErrorMessage,
  ProviderSystemPrompt,
  ProviderThinkingConfig,
  ProviderToolPermissionContext,
  ProviderTools,
} from './contracts.js'
import { getProviderHostBindings } from './host.js'
import type { ProviderRequestOptions } from './requestOptions.js'

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[]

type JsonObject = { [key: string]: JsonValue }

type OptionsTaskBudget = {
  total: number
  remaining?: number
}

export type Options = ProviderRequestOptions & {
  getToolPermissionContext: () => Promise<ProviderToolPermissionContext>
  toolChoice?: BetaToolChoiceTool | BetaToolChoiceAuto | undefined
  extraToolSchemas?: BetaToolUnion[]
  querySource: ProviderQuerySource
  agents: ProviderAgentDefinition[]
  effortValue?: ProviderEffortValue
  mcpTools: ProviderTools
  queryTracking?: ProviderQueryChainTracking
  agentId?: ProviderAgentId
  outputFormat?: BetaJSONOutputFormat
  addNotification?: (notif: ProviderNotification) => void
  fetchOverride?: ClientOptions['fetch']
  taskBudget?: OptionsTaskBudget
}

type ClaudeLegacyRuntime = {
  getExtraBodyParams: (betaHeaders?: string[]) => JsonObject
  getPromptCachingEnabled: (model: string) => boolean
  getCacheControl: (args?: {
    scope?: string
    querySource?: ProviderQuerySource
  }) => { type: 'ephemeral'; ttl?: '1h'; scope?: string }
  configureTaskBudgetParams: (
    taskBudget: Options['taskBudget'],
    outputConfig: BetaMessageStreamParams['output'] & {
      task_budget?: {
        type: 'tokens'
        total: number
        remaining?: number
      }
    },
    betas: string[],
  ) => void
  getAPIMetadata: () => Record<string, unknown>
  verifyApiKey: (...args: any[]) => Promise<any>
  userMessageToMessageParam: (...args: any[]) => MessageParam
  assistantMessageToMessageParam: (...args: any[]) => MessageParam
  queryModelWithoutStreaming: (args: {
    messages: ProviderMessage[]
    systemPrompt: ProviderSystemPrompt
    thinkingConfig: ProviderThinkingConfig
    tools: ProviderTools
    signal: AbortSignal
    options: Options
  }) => Promise<ProviderAssistantMessage>
  queryModelWithStreaming: (args: {
    messages: ProviderMessage[]
    systemPrompt: ProviderSystemPrompt
    thinkingConfig: ProviderThinkingConfig
    tools: ProviderTools
    signal: AbortSignal
    options: Options
  }) => AsyncGenerator<
    ProviderStreamEvent | ProviderAssistantMessage | ProviderSystemAPIErrorMessage,
    void
  >
  executeNonStreamingRequest: (...args: any[]) => AsyncGenerator<any, any>
  stripExcessMediaItems: (...args: any[]) => any
  cleanupStream: (stream: Stream<BetaRawMessageStreamEvent>) => void
  updateUsage: (usage: BetaUsage, delta?: BetaMessageDeltaUsage) => BetaUsage
  accumulateUsage: (...args: any[]) => any
  addCacheBreakpoints: (...args: any[]) => any
  buildSystemPromptBlocks: (
    systemPrompt: ProviderSystemPrompt,
    enablePromptCaching: boolean,
    options?: {
      skipGlobalCacheForSystemPrompt?: boolean
      querySource?: ProviderQuerySource
    },
  ) => TextBlockParam[]
  queryHaiku: (...args: any[]) => Promise<ProviderAssistantMessage>
  queryWithModel: (...args: any[]) => Promise<ProviderAssistantMessage>
  adjustParamsForNonStreaming: <T extends { max_tokens: number; thinking?: BetaMessageStreamParams['thinking'] }>(
    params: T,
    maxTokensCap: number,
  ) => T
  getMaxOutputTokensForModel: (model: string) => number
  MAX_NON_STREAMING_TOKENS?: number
}

function getLegacyRuntime(): ClaudeLegacyRuntime {
  const legacy = getProviderHostBindings().legacy
  if (!legacy) {
    throw new Error(
      'Provider claudeLegacy runtime bindings have not been installed.',
    )
  }
  return legacy as ClaudeLegacyRuntime
}

export function getExtraBodyParams(betaHeaders?: string[]): JsonObject {
  return getLegacyRuntime().getExtraBodyParams(betaHeaders)
}

export function getPromptCachingEnabled(model: string): boolean {
  return getLegacyRuntime().getPromptCachingEnabled(model)
}

export function getCacheControl(args?: {
  scope?: string
  querySource?: ProviderQuerySource
}): { type: 'ephemeral'; ttl?: '1h'; scope?: string } {
  return getLegacyRuntime().getCacheControl(args)
}

export function configureTaskBudgetParams(
  taskBudget: Options['taskBudget'],
  outputConfig: BetaMessageStreamParams['output'] & {
    task_budget?: {
      type: 'tokens'
      total: number
      remaining?: number
    }
  },
  betas: string[],
): void {
  return getLegacyRuntime().configureTaskBudgetParams(
    taskBudget,
    outputConfig,
    betas,
  )
}

export function getAPIMetadata(): Record<string, unknown> {
  return getLegacyRuntime().getAPIMetadata()
}

export async function verifyApiKey(...args: any[]): Promise<any> {
  return getLegacyRuntime().verifyApiKey(...args)
}

export function userMessageToMessageParam(...args: any[]): MessageParam {
  return getLegacyRuntime().userMessageToMessageParam(...args)
}

export function assistantMessageToMessageParam(...args: any[]): MessageParam {
  return getLegacyRuntime().assistantMessageToMessageParam(...args)
}

export async function queryModelWithoutStreaming(args: {
  messages: ProviderMessage[]
  systemPrompt: ProviderSystemPrompt
  thinkingConfig: ProviderThinkingConfig
  tools: ProviderTools
  signal: AbortSignal
  options: Options
}): Promise<ProviderAssistantMessage> {
  return getLegacyRuntime().queryModelWithoutStreaming(args)
}

export async function* queryModelWithStreaming(args: {
  messages: ProviderMessage[]
  systemPrompt: ProviderSystemPrompt
  thinkingConfig: ProviderThinkingConfig
  tools: ProviderTools
  signal: AbortSignal
  options: Options
}): AsyncGenerator<
  ProviderStreamEvent | ProviderAssistantMessage | ProviderSystemAPIErrorMessage,
  void
> {
  yield* getLegacyRuntime().queryModelWithStreaming(args)
}

export async function* executeNonStreamingRequest(
  ...args: any[]
): AsyncGenerator<any, any> {
  yield* getLegacyRuntime().executeNonStreamingRequest(...args)
}

export function stripExcessMediaItems(...args: any[]): any {
  return getLegacyRuntime().stripExcessMediaItems(...args)
}

export function cleanupStream(
  stream: Stream<BetaRawMessageStreamEvent>,
): void {
  return getLegacyRuntime().cleanupStream(stream)
}

export function updateUsage(
  usage: BetaUsage,
  delta?: BetaMessageDeltaUsage,
): BetaUsage {
  return getLegacyRuntime().updateUsage(usage, delta)
}

export function accumulateUsage(...args: any[]): any {
  return getLegacyRuntime().accumulateUsage(...args)
}

export function addCacheBreakpoints(...args: any[]): any {
  return getLegacyRuntime().addCacheBreakpoints(...args)
}

export function buildSystemPromptBlocks(
  systemPrompt: ProviderSystemPrompt,
  enablePromptCaching: boolean,
  options?: {
    skipGlobalCacheForSystemPrompt?: boolean
    querySource?: ProviderQuerySource
  },
): TextBlockParam[] {
  return getLegacyRuntime().buildSystemPromptBlocks(
    systemPrompt,
    enablePromptCaching,
    options,
  )
}

export async function queryHaiku(...args: any[]): Promise<ProviderAssistantMessage> {
  return getLegacyRuntime().queryHaiku(...args)
}

export async function queryWithModel(
  ...args: any[]
): Promise<ProviderAssistantMessage> {
  return getLegacyRuntime().queryWithModel(...args)
}

export const MAX_NON_STREAMING_TOKENS = 64_000

export function adjustParamsForNonStreaming<
  T extends { max_tokens: number; thinking?: BetaMessageStreamParams['thinking'] },
>(params: T, maxTokensCap: number): T {
  return getLegacyRuntime().adjustParamsForNonStreaming(params, maxTokensCap)
}

export function getMaxOutputTokensForModel(model: string): number {
  return getLegacyRuntime().getMaxOutputTokensForModel(model)
}
