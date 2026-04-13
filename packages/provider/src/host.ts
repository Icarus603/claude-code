import type {
  ProviderAPIProvider,
  ProviderAwsCredentials,
  ProviderCachedAsyncFn,
  ProviderModelOption,
  ProviderOauthConfig,
  ProviderOAuthTokens,
} from './contracts.js'
import type { ContextPipeline, NetworkLayer } from './types.js'
import type { ProviderQueryFn, ProviderQueryStreamFn } from './types.js'
import { HostBindingsError } from './errors.js'

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
    query?: ProviderQueryFn
    queryStream?: ProviderQueryStreamFn
  }
  session: {
    addToTotalSessionCost?: (
      costUSD: number,
      usage: unknown,
      model: string,
    ) => void
    logForDebugging?: (message: string, options?: unknown) => void
  }
  legacy?: Record<string, unknown>
}

let providerHostBindings: ProviderHostBindings | null = null

export function installProviderHostBindings(
  bindings: ProviderHostBindings,
): void {
  providerHostBindings = bindings
}

export function getProviderHostBindings(): ProviderHostBindings {
  if (!providerHostBindings) {
    throw new HostBindingsError(
      'Provider host bindings have not been installed. Install the application host bindings before using @claude-code/provider runtime APIs.',
    )
  }
  return providerHostBindings
}
