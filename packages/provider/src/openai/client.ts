import { getProviderNetworkLayer } from '../network.js'
import OpenAI from 'openai'
import { readEnv } from '@claude-code/config/env'

/**
 * Environment variables:
 *
 * OPENAI_API_KEY: Required. API key for the OpenAI-compatible endpoint.
 * OPENAI_BASE_URL: Recommended. Base URL for the endpoint (e.g. http://localhost:11434/v1).
 * OPENAI_ORG_ID: Optional. Organization ID.
 * OPENAI_PROJECT_ID: Optional. Project ID.
 */

let cachedClient: OpenAI | null = null

export function getOpenAIClient(options?: {
  maxRetries?: number
  fetchOverride?: any
  source?: string
}): OpenAI {
  if (cachedClient) return cachedClient
  const networkLayer = getProviderNetworkLayer()

  const apiKey = readEnv('OPENAI_API_KEY') || ''
  const baseURL = readEnv('OPENAI_BASE_URL')

  const client = new OpenAI({
    apiKey,
    ...(baseURL && { baseURL }),
    maxRetries: options?.maxRetries ?? 0,
    timeout: parseInt(readEnv('API_TIMEOUT_MS') || String(600 * 1000), 10),
    dangerouslyAllowBrowser: true,
    ...(readEnv('OPENAI_ORG_ID') && { organization: readEnv('OPENAI_ORG_ID') }),
    ...(readEnv('OPENAI_PROJECT_ID') && { project: readEnv('OPENAI_PROJECT_ID') }),
    fetchOptions: networkLayer.getProxyFetchOptions({
      forAnthropicAPI: false,
    }) as any,
    ...(options?.fetchOverride && { fetch: options.fetchOverride as any }),
  })

  if (!options?.fetchOverride) {
    cachedClient = client
  }

  return client
}

/** Clear the cached client (useful when env vars change). */
export function clearOpenAIClientCache(): void {
  cachedClient = null
}
