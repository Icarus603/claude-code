import { getProviderNetworkLayer } from '../network.js'
import OpenAI from 'openai'
import { readEnv } from '@claude-code/config/env'
import { resolveConnectionForModel } from '../providers.js'

/**
 * Connection registry is the source of truth for endpoint+key. When a
 * connection record matches the requested model, its endpoint/key win
 * over env vars — that's how multiple OpenAI Compatible providers can
 * coexist (Ollama + DeepSeek + vLLM each have their own connection).
 *
 * Env-var fallback (legacy single-provider mode):
 *   OPENAI_API_KEY      Required. API key.
 *   OPENAI_BASE_URL     Recommended. Base URL.
 *   OPENAI_ORG_ID       Optional.
 *   OPENAI_PROJECT_ID   Optional.
 */

// Cache by connection id (or env-fallback key) so multiple connections
// don't clobber a single shared client. Switching models triggers a new
// lookup; the old client is GC'd if nothing references it.
const clientCache = new Map<string, OpenAI>()

export function getOpenAIClient(options?: {
  maxRetries?: number
  fetchOverride?: any
  source?: string
  /** Model id — used to resolve connection-specific endpoint/key. */
  model?: string
}): OpenAI {
  const networkLayer = getProviderNetworkLayer()

  const conn = options?.model
    ? resolveConnectionForModel(options.model)
    : undefined
  const usingConn = conn?.protocol === 'openai' && conn.auth.type === 'api_key'

  const apiKey = usingConn
    ? (conn.auth.type === 'api_key' ? conn.auth.key : '')
    : readEnv('OPENAI_API_KEY') || ''
  const baseURL = usingConn ? conn.endpoint : readEnv('OPENAI_BASE_URL')

  // Cache key: 'conn:<id>' for per-connection clients, 'env' for fallback.
  // fetchOverride disables caching (test seam).
  const cacheKey = usingConn && conn ? `conn:${conn.id}` : 'env'
  if (!options?.fetchOverride) {
    const cached = clientCache.get(cacheKey)
    if (cached) return cached
  }

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
    clientCache.set(cacheKey, client)
  }

  return client
}

/** Clear the cached clients (useful when connections change at runtime). */
export function clearOpenAIClientCache(): void {
  clientCache.clear()
}
