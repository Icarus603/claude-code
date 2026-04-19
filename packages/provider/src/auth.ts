import type {
  AnthropicCredentials,
  AuthProvider,
  ProviderAuthContext,
  ProviderAvailability,
} from './types.js'
import { getProviderHostBindings } from './host.js'
import { readEnv } from '@claude-code/config/env'

async function getAnthropicAuthorizationHeader(
  context?: ProviderAuthContext,
): Promise<string | null> {
  const { auth } = getProviderHostBindings()
  const token =
    readEnv('ANTHROPIC_AUTH_TOKEN') ||
    (await auth.getApiKeyFromApiKeyHelper(
      context?.isNonInteractiveSession ?? false,
    ))
  return token ? `Bearer ${token}` : null
}

export const anthropicAuthProvider: AuthProvider<AnthropicCredentials> = {
  id: 'anthropic',
  async refresh(): Promise<void> {
    await getProviderHostBindings().auth.checkAndRefreshOAuthTokenIfNeeded()
  },
  async getCredentials(
    context?: ProviderAuthContext,
  ): Promise<AnthropicCredentials> {
    const { auth } = getProviderHostBindings()
    await auth.checkAndRefreshOAuthTokenIfNeeded()

    const subscriber = auth.isClaudeAISubscriber()
    const apiKey = subscriber
      ? null
      : context?.apiKeyOverride || auth.getAnthropicApiKey()
    const authToken = subscriber
      ? auth.getClaudeAIOAuthTokens()?.accessToken ?? null
      : null

    return {
      subscriber,
      apiKey,
      authToken,
      authorizationHeader: subscriber
        ? null
        : await getAnthropicAuthorizationHeader(context),
      ...(readEnv('USER_TYPE') === 'ant' &&
      auth.isEnvTruthy(readEnv('USE_STAGING_OAUTH'))
        ? { baseURL: auth.getOauthConfig().BASE_API_URL }
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
  () => readEnv('OPENAI_API_KEY'),
  'OPENAI_API_KEY is not configured.',
)

export const geminiAuthProvider = createEnvAuthProvider(
  'gemini',
  () => readEnv('GEMINI_API_KEY'),
  'GEMINI_API_KEY is not configured.',
)

export const grokAuthProvider = createEnvAuthProvider(
  'grok',
  () => readEnv('GROK_API_KEY') || readEnv('XAI_API_KEY'),
  'GROK_API_KEY or XAI_API_KEY is not configured.',
)

export function getAnthropicAuthProvider(): AuthProvider<AnthropicCredentials> {
  return anthropicAuthProvider
}
