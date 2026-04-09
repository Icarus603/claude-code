import type {
  ProviderAPIProvider,
  ProviderAgentDefinition,
  ProviderAssistantMessage,
  ProviderAwsCredentials,
  ProviderCachedAsyncFn,
  ProviderMessage,
  ProviderModelOption,
  ProviderOauthConfig,
  ProviderOAuthTokens,
  ProviderQuerySource,
  ProviderSafeParseJSONFn,
  ProviderSystemAPIErrorMessage,
  ProviderTool,
  ProviderToolPermissionContext,
  ProviderTools,
  ProviderToolSchema,
  ProviderToolSchemaOptions,
} from './contracts.js'
import type { ContextPipeline, NetworkLayer } from './types.js'

export type ProviderHostBindings = {
  contextPipeline: ContextPipeline
  networkLayer: NetworkLayer
  getAPIProvider: () => ProviderAPIProvider
  getModelOptions: (fastMode?: boolean) => ProviderModelOption[]
  auth: {
    checkAndRefreshOAuthTokenIfNeeded: () => Promise<void | boolean>
    getAnthropicApiKey: () => string | null | undefined
    getApiKeyFromApiKeyHelper: (
      isNonInteractiveSession: boolean,
    ) => Promise<string | null | undefined>
    getClaudeAIOAuthTokens: () => ProviderOAuthTokens
    isClaudeAISubscriber: () => boolean
    isEnvTruthy: (value: unknown) => boolean
    getOauthConfig: () => ProviderOauthConfig
  }
  anthropic: {
    refreshAndGetAwsCredentials: ProviderCachedAsyncFn<
      ProviderAwsCredentials | null | undefined
    >
    refreshGcpCredentialsIfNeeded: ProviderCachedAsyncFn<void | boolean>
    getUserAgent: () => string
    getSmallFastModel: () => string
    isFirstPartyAnthropicBaseUrl: () => boolean
    getIsNonInteractiveSession: () => boolean
    getSessionId: () => string
    isDebugToStdErr: () => boolean
    logForDebugging: (message: string, options?: unknown) => void
    getAWSRegion: () => string
    getVertexRegionForModel: (model: string) => string
    isEnvTruthy: (value: unknown) => boolean
  }
  runtime: {
    toolToAPISchema: (
      tool: ProviderTool,
      options: ProviderToolSchemaOptions,
    ) => Promise<ProviderToolSchema>
    addToTotalSessionCost: (
      costUSD: number,
      usage: unknown,
      model: string,
    ) => void
    logForDebugging: (message: string, options?: unknown) => void
    createAssistantAPIErrorMessage: (args: {
      content: string
      apiError?: unknown
      error?: unknown
      errorDetails?: string
    }) => ProviderAssistantMessage | ProviderSystemAPIErrorMessage
    normalizeContentFromAPI: (
      blocks: unknown,
      tools: ProviderTools,
      agentId?: string,
    ) => ProviderMessage['message']['content']
    normalizeMessagesForAPI: (
      messages: readonly ProviderMessage[],
      tools: ProviderTools,
    ) => ProviderMessage[]
    calculateUSDCost: (
      model: string,
      usage: unknown,
    ) => number
    isToolSearchEnabled: (
      model: string,
      tools: ProviderTools,
      getToolPermissionContext: () => Promise<ProviderToolPermissionContext>,
      agents: readonly ProviderAgentDefinition[],
      querySource?: ProviderQuerySource,
    ) => Promise<boolean>
    extractDiscoveredToolNames: (
      messages: readonly ProviderMessage[],
    ) => Set<string>
    isDeferredTool: (tool: ProviderTool) => boolean
    TOOL_SEARCH_TOOL_NAME: string
    safeParseJSON: ProviderSafeParseJSONFn
    errorMessage: (error: unknown) => string
  }
}

let providerHostBindings: ProviderHostBindings | null = null

export function installProviderHostBindings(
  bindings: ProviderHostBindings,
): void {
  providerHostBindings = bindings
}

export function getProviderHostBindings(): ProviderHostBindings {
  if (!providerHostBindings) {
    throw new Error(
      'Provider host bindings have not been installed. Install the application host bindings before using @claude-code/provider runtime APIs.',
    )
  }
  return providerHostBindings
}
