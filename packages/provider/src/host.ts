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
// Keep HostBindingsError inline to avoid top-level import of errors.js,
// which transitively loads src/services/api/providerHostSetup.ts and
// causes TDZ on host.ts's module-level state if install() fires during init.
class HostBindingsError extends Error {
  readonly code = 'PROVIDER_HOST_BINDINGS_NOT_INSTALLED'
  constructor(message: string) {
    super(message)
    this.name = 'ProviderHostBindingsError'
  }
}

export type ProviderHostBindings = {
  contextPipeline: ContextPipeline
  networkLayer: NetworkLayer
  getAPIProvider: () => ProviderAPIProvider
  getModelOptions: (fastMode?: boolean) => ProviderModelOption[]
  auth: {
    checkAndRefreshOAuthTokenIfNeeded: () => Promise<undefined | boolean>
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
    refreshGcpCredentialsIfNeeded: ProviderCachedAsyncFn<undefined | boolean>
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

// Module-level state held in a const container so circular-import re-entry
// during top-level install() can't trip TDZ on a `let`.
const state: { bindings: ProviderHostBindings | null } = { bindings: null }

export function installProviderHostBindings(
  bindings: ProviderHostBindings,
): void {
  state.bindings = bindings
}

export function getProviderHostBindings(): ProviderHostBindings {
  if (!state.bindings) {
    throw new HostBindingsError(
      'Provider host bindings have not been installed. Install the application host bindings before using @claude-code/provider runtime APIs.',
    )
  }
  return state.bindings
}
