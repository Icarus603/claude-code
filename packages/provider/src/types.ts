import type { ClientOptions } from '@anthropic-ai/sdk'
import type {
  ProviderAPIProvider,
  ProviderAssistantMessage,
  ProviderMessage,
  ProviderModelOption,
  ProviderStreamEvent,
  ProviderSystemAPIErrorMessage,
  ProviderSystemPrompt,
  ProviderThinkingConfig,
  ProviderTools,
} from './contracts.js'
import type { ProviderRequestOptions } from './requestOptions.js'

export type ProviderQueryArgs = {
  messages: readonly ProviderMessage[]
  systemPrompt: ProviderSystemPrompt
  tools: ProviderTools
  signal: AbortSignal
  options: ProviderRequestOptions
  thinkingConfig: ProviderThinkingConfig
}

export type ProviderQueryStream = AsyncGenerator<
  | ProviderStreamEvent
  | ProviderAssistantMessage
  | ProviderSystemAPIErrorMessage,
  void
>

export type ProviderQueryFn = (
  args: ProviderQueryArgs,
) => Promise<ProviderAssistantMessage>

export type ProviderQueryStreamFn = (
  args: ProviderQueryArgs,
) => ProviderQueryStream

export type ProviderAvailability = {
  available: boolean
  reason?: string
}

export type NetworkLayer = {
  getProxyFetchOptions(
    opts?: Record<string, unknown>,
  ): Record<string, unknown> | undefined
  createAxiosInstance(extra?: Record<string, unknown>): unknown
  getProxyUrl(env?: NodeJS.ProcessEnv): string | undefined
  shouldBypassProxy(url: string, noProxy?: string): boolean
}

export type ContextPipeline = {
  getUserContext(): Promise<Record<string, string>>
  getSystemContext(): Promise<Record<string, string>>
}

export type ProviderAuthContext = {
  apiKeyOverride?: string
  isNonInteractiveSession?: boolean
}

export type AnthropicCredentials = {
  subscriber: boolean
  apiKey: string | null
  authToken: string | null
  authorizationHeader: string | null
  baseURL?: string
}

export type AuthProvider<TCredentials = unknown> = {
  id: string
  refresh(): Promise<void>
  getCredentials(context?: ProviderAuthContext): Promise<TCredentials>
  invalidate?(): Promise<void> | void
  isAvailable(context?: ProviderAuthContext): Promise<ProviderAvailability>
}

export type ProviderAdapter = {
  id: ProviderAPIProvider
  authProvider: AuthProvider
  contextPipeline: ContextPipeline
  networkLayer: NetworkLayer
  query: ProviderQueryFn
  queryStream: ProviderQueryStreamFn
  listModels(fastMode?: boolean): ProviderModelOption[]
  isAvailable(context?: ProviderAuthContext): Promise<ProviderAvailability>
}

export type ProviderAdapterOverrides = {
  anthropicQuery?: ProviderQueryFn
  anthropicQueryStream?: ProviderQueryStreamFn
}

export type ProviderClientFetch = ClientOptions['fetch']
export type APIProvider = ProviderAPIProvider
