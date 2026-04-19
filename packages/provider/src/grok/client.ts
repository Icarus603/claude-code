import { getProviderNetworkLayer } from '../network.js'
import OpenAI from 'openai'
import { readEnv } from '@claude-code/config/env'

/**
 * Environment variables:
 *
 * GROK_API_KEY (or XAI_API_KEY): Required. API key for the xAI Grok endpoint.
 * GROK_BASE_URL: Optional. Defaults to https://api.x.ai/v1.
 */

const DEFAULT_BASE_URL = 'https://api.x.ai/v1'

let cachedClient: OpenAI | null = null

export function getGrokClient(options?: {
  maxRetries?: number
  fetchOverride?: any
  source?: string
}): OpenAI {
  if (cachedClient) return cachedClient
  const networkLayer = getProviderNetworkLayer()

  const apiKey = readEnv('GROK_API_KEY') || readEnv('XAI_API_KEY') || ''
  const baseURL = readEnv('GROK_BASE_URL') || DEFAULT_BASE_URL

  const client = new OpenAI({
    apiKey,
    baseURL,
    maxRetries: options?.maxRetries ?? 0,
    timeout: parseInt(readEnv('API_TIMEOUT_MS') || String(600 * 1000), 10),
    dangerouslyAllowBrowser: true,
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

export function clearGrokClientCache(): void {
  cachedClient = null
}
