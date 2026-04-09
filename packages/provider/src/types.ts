import type { ClientOptions } from '@anthropic-ai/sdk'
import type { AssistantMessage } from '../../../src/types/message.js'
import type {
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../../src/types/message.js'
import type { Tools } from '../../../src/Tool.js'
import type { SystemPrompt } from '../../../src/utils/systemPromptType.js'
import type { ThinkingConfig } from '../../../src/utils/thinking.js'
import type { ModelOption } from '../../../src/utils/model/modelOptions.js'
import type {
  APIProvider,
} from '../../../src/utils/model/providers.js'
import type { Options as ClaudeQueryOptions } from '../../../src/services/api/claude.js'

export type ProviderQueryArgs = {
  messages: Message[]
  systemPrompt: SystemPrompt
  tools: Tools
  signal: AbortSignal
  options: ClaudeQueryOptions
  thinkingConfig: ThinkingConfig
}

export type ProviderQueryStream = AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
>

export type ProviderQueryFn = (
  args: ProviderQueryArgs,
) => Promise<AssistantMessage>

export type ProviderQueryStreamFn = (
  args: ProviderQueryArgs,
) => ProviderQueryStream

export type ProviderAvailability = {
  available: boolean
  reason?: string
}

export type NetworkLayer = {
  getProxyFetchOptions(
    opts?: Parameters<
      typeof import('../../../src/utils/proxy.js').getProxyFetchOptions
    >[0],
  ): ReturnType<typeof import('../../../src/utils/proxy.js').getProxyFetchOptions>
  createAxiosInstance(
    extra?: Parameters<
      typeof import('../../../src/utils/proxy.js').createAxiosInstance
    >[0],
  ): ReturnType<typeof import('../../../src/utils/proxy.js').createAxiosInstance>
  getProxyUrl(
    env?: Parameters<typeof import('../../../src/utils/proxy.js').getProxyUrl>[0],
  ): ReturnType<typeof import('../../../src/utils/proxy.js').getProxyUrl>
  shouldBypassProxy(
    url: string,
    noProxy?: string,
  ): ReturnType<typeof import('../../../src/utils/proxy.js').shouldBypassProxy>
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
  id: APIProvider
  authProvider: AuthProvider
  contextPipeline: ContextPipeline
  networkLayer: NetworkLayer
  query: ProviderQueryFn
  queryStream: ProviderQueryStreamFn
  listModels(fastMode?: boolean): ModelOption[]
  isAvailable(context?: ProviderAuthContext): Promise<ProviderAvailability>
}

export type ProviderAdapterOverrides = {
  anthropicQuery?: ProviderQueryFn
  anthropicQueryStream?: ProviderQueryStreamFn
}

export type ProviderClientFetch = ClientOptions['fetch']
