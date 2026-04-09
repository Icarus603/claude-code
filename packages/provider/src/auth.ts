import {
  checkAndRefreshOAuthTokenIfNeeded,
  getAnthropicApiKey,
  getApiKeyFromApiKeyHelper,
  getClaudeAIOAuthTokens,
  isClaudeAISubscriber,
} from '../../../src/utils/auth.js'
import { isEnvTruthy } from '../../../src/utils/envUtils.js'
import { getOauthConfig } from '../../../src/constants/oauth.js'
import type {
  AnthropicCredentials,
  AuthProvider,
  ProviderAuthContext,
  ProviderAvailability,
} from './types.js'

async function getAnthropicAuthorizationHeader(
  context?: ProviderAuthContext,
): Promise<string | null> {
  const token =
    process.env.ANTHROPIC_AUTH_TOKEN ||
    (await getApiKeyFromApiKeyHelper(context?.isNonInteractiveSession ?? false))
  return token ? `Bearer ${token}` : null
}

export const anthropicAuthProvider: AuthProvider<AnthropicCredentials> = {
  id: 'anthropic',
  async refresh(): Promise<void> {
    await checkAndRefreshOAuthTokenIfNeeded()
  },
  async getCredentials(
    context?: ProviderAuthContext,
  ): Promise<AnthropicCredentials> {
    await checkAndRefreshOAuthTokenIfNeeded()

    const subscriber = isClaudeAISubscriber()
    const apiKey = subscriber
      ? null
      : context?.apiKeyOverride || getAnthropicApiKey()
    const authToken = subscriber
      ? getClaudeAIOAuthTokens()?.accessToken ?? null
      : null

    return {
      subscriber,
      apiKey,
      authToken,
      authorizationHeader: subscriber
        ? null
        : await getAnthropicAuthorizationHeader(context),
      ...(process.env.USER_TYPE === 'ant' &&
      isEnvTruthy(process.env.USE_STAGING_OAUTH)
        ? { baseURL: getOauthConfig().BASE_API_URL }
        : {}),
    }
  },
  async isAvailable(
    context?: ProviderAuthContext,
  ): Promise<ProviderAvailability> {
    const creds = await this.getCredentials(context)
    if (creds.subscriber || creds.apiKey || creds.authToken) {
      return { available: true }
    }
    return {
      available: false,
      reason: 'No Anthropic API key or Claude.ai OAuth token is configured.',
    }
  },
}

function createEnvAuthProvider(
  id: string,
  getToken: () => string | undefined,
  reason: string,
): AuthProvider<{ apiKey: string | null }> {
  return {
    id,
    async refresh(): Promise<void> {},
    async getCredentials(): Promise<{ apiKey: string | null }> {
      return { apiKey: getToken() ?? null }
    },
    async isAvailable(): Promise<ProviderAvailability> {
      return getToken()
        ? { available: true }
        : { available: false, reason }
    },
  }
}

export const openAIAuthProvider = createEnvAuthProvider(
  'openai',
  () => process.env.OPENAI_API_KEY,
  'OPENAI_API_KEY is not configured.',
)

export const geminiAuthProvider = createEnvAuthProvider(
  'gemini',
  () => process.env.GEMINI_API_KEY,
  'GEMINI_API_KEY is not configured.',
)

export const grokAuthProvider = createEnvAuthProvider(
  'grok',
  () => process.env.GROK_API_KEY || process.env.XAI_API_KEY,
  'GROK_API_KEY or XAI_API_KEY is not configured.',
)

export function getAnthropicAuthProvider(): AuthProvider<AnthropicCredentials> {
  return anthropicAuthProvider
}
