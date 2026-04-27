import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '@claude-code/local-observability/compat'
import { getInitialSettings } from '@claude-code/config/settings'
import { isEnvTruthy, readEnv } from '@claude-code/config/env/utils'
import { getGlobalConfig } from '@claude-code/config'
import type { ConnectionRecord } from '@claude-code/config'

export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'
  | 'gemini'
  | 'grok'
  | 'codex'

export function getAPIProvider(): APIProvider {
  const modelType = getInitialSettings().modelType
  if (modelType === 'openai') return 'openai'
  if (modelType === 'gemini') return 'gemini'
  if (modelType === 'grok') return 'grok'

  if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_BEDROCK'))) return 'bedrock'
  if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_VERTEX'))) return 'vertex'
  if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_FOUNDRY'))) return 'foundry'

  if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_OPENAI'))) return 'openai'
  if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_GEMINI'))) return 'gemini'
  if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_GROK'))) return 'grok'

  // Connection-based routing: check if any codex connection is enabled
  if (getEnabledConnections().some(c => c.protocol === 'codex')) return 'codex'

  return 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

// ── Connection-based model routing ──────────────────────────────────────

/**
 * Get all enabled connections from config.
 */
export function getEnabledConnections(): ConnectionRecord[] {
  const config = getGlobalConfig()
  return (config.connections ?? []).filter(c => c.enabled)
}

/**
 * Resolve which connection (and thus which provider/protocol) to use for a
 * given model ID. Searches all enabled connections' model lists.
 *
 * Returns the matching connection, or undefined if the model doesn't belong
 * to any registered connection (falls back to getAPIProvider()).
 */
export function resolveConnectionForModel(
  modelId: string,
): ConnectionRecord | undefined {
  const normalized = modelId.trim().toLowerCase()
  for (const conn of getEnabledConnections()) {
    for (const m of conn.models) {
      if (m.id.trim().toLowerCase() === normalized) {
        return conn
      }
    }
    // Also check via family matching (e.g., "opus" matches "claude-opus-4-7")
    if (conn.protocol === 'anthropic') {
      if (
        (normalized.includes('opus') &&
          conn.models.some(m => m.id.toLowerCase().includes('opus'))) ||
        (normalized.includes('sonnet') &&
          conn.models.some(m => m.id.toLowerCase().includes('sonnet'))) ||
        (normalized.includes('haiku') &&
          conn.models.some(m => m.id.toLowerCase().includes('haiku')))
      ) {
        return conn
      }
    }
  }
  return undefined
}

/**
 * Get the APIProvider to use for a specific model.
 * Prefers connection-based routing over the global provider.
 */
export function getProviderForModel(modelId: string): APIProvider {
  const conn = resolveConnectionForModel(modelId)
  if (conn) {
    return conn.protocol === 'codex' ? 'codex' : conn.protocol as APIProvider
  }
  return getAPIProvider()
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = readEnv('ANTHROPIC_BASE_URL')
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
