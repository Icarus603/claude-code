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
  // V7 §11.6 — when ANY connection is configured, the connection
  // registry is the source of truth. Per-model routing happens via
  // `getProviderForModel()` / `resolveConnectionForModel()`; this
  // function is only the GLOBAL FALLBACK for code paths without a
  // model in hand (error formatting, beta header default, …).
  //
  // In that fallback role the legacy `CLAUDE_CODE_USE_OPENAI=1` /
  // `settings.modelType='openai'` flags are actively wrong: a stale
  // residue from a prior Codex/OpenAI session tags every fallback as
  // 'openai' even on a Claude Account, leaking the wrong provider
  // name into 404 messages and corrupting model defaults. Ignore
  // those flags whenever connections exist — routing has already
  // been decided per model. Cloud-deployment env vars
  // (Bedrock/Vertex/Foundry) ARE still honored because those
  // deployments aren't connection-aware yet.
  //
  // Pure env-only setups (no connections) keep the legacy precedence
  // untouched, including `modelType` taking priority over Bedrock
  // env, since callers there have nothing else to disambiguate
  // intent.
  const hasConnections = (() => {
    try {
      return (getGlobalConfig().connections ?? []).some(c => c.enabled)
    } catch {
      return false
    }
  })()
  if (hasConnections) {
    if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_BEDROCK'))) return 'bedrock'
    if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_VERTEX'))) return 'vertex'
    if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_FOUNDRY'))) return 'foundry'
    return 'firstParty'
  }

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
  try {
    const config = getGlobalConfig()
    return (config.connections ?? []).filter(c => c.enabled)
  } catch {
    // Config not available yet during early bootstrap — return empty
    return []
  }
}

/**
 * Resolve which connection to use for a given model id.
 *
 * Three-stage lookup:
 *
 *   1. **Exact connection prefix** — if the value is `<connId>:<model>`
 *      and an enabled connection with that id exists, return it. This is
 *      the picker's primary disambiguation when multiple connections
 *      share the same model name.
 *
 *   2. **Bare model id match** — if no prefix, search all enabled
 *      connections for a `models[].id` exact match.
 *
 *   3. **Family match (anthropic only)** — for legacy callers passing
 *      "opus" / "sonnet" / "haiku" aliases, return the first anthropic
 *      connection whose model list contains that family. Preserves
 *      backwards compatibility with `--model opus` style invocation.
 *
 * Returns undefined when no connection matches; the caller falls back
 * to `getAPIProvider()` (env-var driven).
 */
export function resolveConnectionForModel(
  modelId: string,
): ConnectionRecord | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unpackModelId } = require(
    '@claude-code/provider/connections.js',
  ) as typeof import('@claude-code/provider/connections.js')
  const { connectionId, modelId: bareModelId } = unpackModelId(modelId)

  if (connectionId) {
    const exact = getEnabledConnections().find(c => c.id === connectionId)
    if (exact) return exact
    // Stale prefix (connection was deleted) — fall through to family/bare
    // search using the bare model id.
  }

  const normalized = bareModelId.trim().toLowerCase()
  for (const conn of getEnabledConnections()) {
    for (const m of conn.models) {
      if (m.id.trim().toLowerCase() === normalized) {
        return conn
      }
    }
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
