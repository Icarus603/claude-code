import {
  installProviderHostBindings,
  type ProviderHostBindings,
} from './host.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getAnthropicApiKey,
  getApiKeyFromApiKeyHelper,
  getClaudeAIOAuthTokens,
  isClaudeAISubscriber,
  refreshAndGetAwsCredentials,
  refreshGcpCredentialsIfNeeded,
} from '@claude-code/app-compat/utils/auth.js'
import {
  createAxiosInstance,
  getProxyFetchOptions,
  getProxyUrl,
  shouldBypassProxy,
} from '@claude-code/app-compat/utils/proxy.js'
import { getOauthConfig } from '@claude-code/app-compat/constants/oauth.js'
import { getUserContext, getSystemContext } from '@claude-code/app-compat/context.js'
import { getUserAgent } from '@claude-code/app-compat/utils/http.js'
import { getSmallFastModel } from '@claude-code/app-compat/utils/model/model.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '@claude-code/app-compat/utils/model/providers.js'
import { getModelOptions } from '@claude-code/app-compat/utils/model/modelOptions.js'
import {
  getIsNonInteractiveSession,
  getSessionId,
} from '@claude-code/app-compat/bootstrap/state.js'
import { isDebugToStdErr, logForDebugging } from '@claude-code/app-compat/utils/debug.js'
import {
  getAWSRegion,
  getVertexRegionForModel,
  isEnvTruthy,
} from '@claude-code/app-compat/utils/envUtils.js'
import { addToTotalSessionCost } from '@claude-code/app-compat/cost-tracker.js'

const anthropicQueryBinding: NonNullable<
  ProviderHostBindings['anthropic']['query']
> = async args => {
  const { queryModelWithoutStreaming } = await import('./claudeLegacy.js')
  return (await queryModelWithoutStreaming({
    messages: args.messages as any,
    systemPrompt: args.systemPrompt as any,
    thinkingConfig: args.thinkingConfig as any,
    tools: args.tools as any,
    signal: args.signal,
    options: args.options as any,
  })) as any
}

const anthropicQueryStreamBinding: NonNullable<
  ProviderHostBindings['anthropic']['queryStream']
> = async function* (args) {
  const { queryModelWithStreaming } = await import('./claudeLegacy.js')
  yield* queryModelWithStreaming({
    messages: args.messages as any,
    systemPrompt: args.systemPrompt as any,
    thinkingConfig: args.thinkingConfig as any,
    tools: args.tools as any,
    signal: args.signal,
    options: args.options as any,
  })
}

const refreshAndGetAwsCredentialsBinding = Object.assign(
  () => refreshAndGetAwsCredentials(),
  {
    cache: {
      clear: () => refreshAndGetAwsCredentials.cache.clear(),
    },
  },
)

const refreshGcpCredentialsIfNeededBinding = Object.assign(
  () => refreshGcpCredentialsIfNeeded(),
  {
    cache: {
      clear: () => refreshGcpCredentialsIfNeeded.cache.clear(),
    },
  },
)

const bindings: ProviderHostBindings = {
  contextPipeline: {
    getUserContext: () => getUserContext(),
    getSystemContext: () => getSystemContext(),
  },
  networkLayer: {
    getProxyFetchOptions: (...args) => getProxyFetchOptions(...args),
    createAxiosInstance: (...args) => createAxiosInstance(...args),
    getProxyUrl: (...args) => getProxyUrl(...args),
    shouldBypassProxy: (...args) => shouldBypassProxy(...args),
  },
  getAPIProvider: () => getAPIProvider(),
  getModelOptions: fastMode => getModelOptions(fastMode),
  auth: {
    checkAndRefreshOAuthTokenIfNeeded: () =>
      checkAndRefreshOAuthTokenIfNeeded(),
    getAnthropicApiKey: () => getAnthropicApiKey(),
    getApiKeyFromApiKeyHelper: isNonInteractiveSession =>
      getApiKeyFromApiKeyHelper(isNonInteractiveSession),
    getClaudeAIOAuthTokens: () => getClaudeAIOAuthTokens(),
    isClaudeAISubscriber: () => isClaudeAISubscriber(),
    isEnvTruthy: value => isEnvTruthy(value as string | boolean),
    getOauthConfig: () => getOauthConfig(),
  },
  anthropic: {
    refreshAndGetAwsCredentials: refreshAndGetAwsCredentialsBinding,
    refreshGcpCredentialsIfNeeded: refreshGcpCredentialsIfNeededBinding,
    getUserAgent: () => getUserAgent(),
    getSmallFastModel: () => getSmallFastModel(),
    isFirstPartyAnthropicBaseUrl: () => isFirstPartyAnthropicBaseUrl(),
    getIsNonInteractiveSession: () => getIsNonInteractiveSession(),
    getSessionId: () => getSessionId(),
    isDebugToStdErr: () => isDebugToStdErr(),
    logForDebugging: (message, options) =>
      logForDebugging(message, options as any),
    getAWSRegion: () => getAWSRegion(),
    getVertexRegionForModel: model => getVertexRegionForModel(model),
    isEnvTruthy: value => isEnvTruthy(value as string | boolean),
    query: anthropicQueryBinding,
    queryStream: anthropicQueryStreamBinding,
  },
  session: {
    addToTotalSessionCost: (costUSD, usage, model) =>
      addToTotalSessionCost(costUSD, usage as any, model),
    logForDebugging: (message, options) =>
      logForDebugging(message, options as any),
  },
}

let providerHostBindingsInstalled = false

export function installProviderRuntimeBindings(): void {
  if (providerHostBindingsInstalled) {
    return
  }
  installProviderHostBindings(bindings)
  providerHostBindingsInstalled = true
}

installProviderRuntimeBindings()
