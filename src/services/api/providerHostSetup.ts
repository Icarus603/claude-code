import {
  installProviderHostBindings,
  type ProviderHostBindings,
} from '@claude-code/provider'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getAnthropicApiKey,
  getApiKeyFromApiKeyHelper,
  getClaudeAIOAuthTokens,
  isClaudeAISubscriber,
  refreshAndGetAwsCredentials,
  refreshGcpCredentialsIfNeeded,
} from 'src/utils/auth.js'
import {
  createAxiosInstance,
  getProxyFetchOptions,
  getProxyUrl,
  shouldBypassProxy,
} from 'src/utils/proxy.js'
import { getOauthConfig } from 'src/constants/oauth.js'
import { getUserContext, getSystemContext } from 'src/context.js'
import { getUserAgent } from 'src/utils/http.js'
import { getSmallFastModel } from 'src/utils/model/model.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import { getModelOptions } from 'src/utils/model/modelOptions.js'
import {
  getIsNonInteractiveSession,
  getSessionId,
} from 'src/bootstrap/state.js'
import { isDebugToStdErr, logForDebugging } from 'src/utils/debug.js'
import {
  getAWSRegion,
  getVertexRegionForModel,
  isEnvTruthy,
} from 'src/utils/envUtils.js'
import { toolToAPISchema } from 'src/utils/api.js'
import { addToTotalSessionCost } from 'src/cost-tracker.js'
import {
  createAssistantAPIErrorMessage,
  normalizeContentFromAPI,
  normalizeMessagesForAPI,
} from 'src/utils/messages.js'
import { calculateUSDCost } from 'src/utils/modelCost.js'
import {
  extractDiscoveredToolNames,
  isToolSearchEnabled,
} from 'src/utils/toolSearch.js'
import {
  isDeferredTool,
  TOOL_SEARCH_TOOL_NAME,
} from 'src/tools/ToolSearchTool/prompt.js'
import { safeParseJSON } from 'src/utils/json.js'
import { errorMessage } from 'src/utils/errors.js'

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

const safeParseJSONBinding = Object.assign(
  (json: string, shouldLogError?: boolean) =>
    safeParseJSON(json, shouldLogError),
  {
    cache: {
      clear: () => safeParseJSON.cache.clear(),
      size: () => safeParseJSON.cache.size(),
      delete: (key: string) => safeParseJSON.cache.delete(key),
      get: (key: string) => safeParseJSON.cache.get(key),
      has: (key: string) => safeParseJSON.cache.has(key),
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
  },
  runtime: {
    toolToAPISchema: (tool, options) =>
      toolToAPISchema(tool as any, options as any) as any,
    addToTotalSessionCost: (costUSD, usage, model) =>
      addToTotalSessionCost(costUSD, usage as any, model),
    logForDebugging: (message, options) =>
      logForDebugging(message, options as any),
    createAssistantAPIErrorMessage: args =>
      createAssistantAPIErrorMessage(args as any) as any,
    normalizeContentFromAPI: (blocks, tools, agentId) =>
      normalizeContentFromAPI(blocks as any, tools as any, agentId as any) as any,
    normalizeMessagesForAPI: (messages, tools) =>
      normalizeMessagesForAPI(messages as any, tools as any) as any,
    calculateUSDCost: (model, usage) => calculateUSDCost(model, usage as any),
    isToolSearchEnabled: (
      model,
      tools,
      getToolPermissionContext,
      agents,
      querySource,
    ) =>
      isToolSearchEnabled(
        model,
        tools as any,
        getToolPermissionContext as any,
        agents as any,
        querySource as any,
      ),
    extractDiscoveredToolNames: messages =>
      extractDiscoveredToolNames(messages as any),
    isDeferredTool: tool => isDeferredTool(tool as any),
    TOOL_SEARCH_TOOL_NAME,
    safeParseJSON: safeParseJSONBinding,
    errorMessage: error => errorMessage(error as any),
  },
}

installProviderHostBindings(bindings)
