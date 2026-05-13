import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '@claude-code/local-observability/compat'
import { getInitialSettings } from '@claude-code/config/settings'
import { isEnvTruthy, readEnv } from '@claude-code/config/env/utils'
import { getGlobalConfig } from '@claude-code/config'
import type { ConnectionRecord } from '@claude-code/config'
import { isFirstPartyAnthropicConnection } from './connections.js'

export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'
  | 'gemini'
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
  // Ant lq() priority: BEDROCK > FOUNDRY > ANTHROPIC_AWS > MANTLE > VERTEX.
  // ccb has no impl for ANTHROPIC_AWS / MANTLE so the env vars fall through
  // to firstParty (isAnthropicAuthEnabled still gates OAuth Bearer off when
  // they're set, so credentials don't leak — see authAlias.ts is3P check).
  if (hasConnections) {
    if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_BEDROCK'))) return 'bedrock'
    if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_FOUNDRY'))) return 'foundry'
    if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_VERTEX'))) return 'vertex'
    return 'firstParty'
  }

  const modelType = getInitialSettings().modelType
  if (modelType === 'openai') return 'openai'
  if (modelType === 'gemini') return 'gemini'
  if (modelType === 'codex') return 'codex'

  if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_BEDROCK'))) return 'bedrock'
  if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_FOUNDRY'))) return 'foundry'
  if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_VERTEX'))) return 'vertex'

  if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_OPENAI'))) return 'openai'
  if (isEnvTruthy(readEnv('CLAUDE_CODE_USE_GEMINI'))) return 'gemini'

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
    './connections.js',
  ) as typeof import('./connections.js')
  const { connectionId, modelId: bareModelId } = unpackModelId(modelId)

  if (connectionId) {
    const exact = getEnabledConnections().find(c => c.id === connectionId)
    if (exact) return exact
    // Stale prefix (connection was deleted) — fall through to family/bare
    // search using the bare model id.
  }

  const normalizeForMatch = (id: string) =>
    id.trim().toLowerCase().replace(/\[(1|2)m\]$/i, '')
  const normalized = normalizeForMatch(bareModelId)
  for (const conn of getEnabledConnections()) {
    for (const m of conn.models) {
      if (normalizeForMatch(m.id) === normalized) {
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
 *
 * `AuthProtocol` (`'anthropic' | 'openai' | 'codex' | 'gemini'`) and
 * `APIProvider` (firstParty/bedrock/vertex/foundry/openai/gemini/codex)
 * are different vocabularies — only the last three values overlap. The
 * old code did `conn.protocol as APIProvider`, which silently leaked the
 * string `'anthropic'` (a valid AuthProtocol but not a valid APIProvider)
 * into downstream callers. Most callers default-Anthropic on unknown
 * values so the leak was invisible, but `isAnthropicServerWebSearchCapable`
 * has a `default: false` switch that broke connection-routed Anthropic
 * users on the v26.5.25 WebSearch routing change.
 *
 * The right translation: `protocol === 'anthropic'` connections are
 * "Anthropic-protocol on some endpoint" — at this layer we don't
 * distinguish native vs proxy because the APIProvider enum doesn't model
 * that axis. We translate to `'firstParty'`. Callers that genuinely need
 * the proxy/native distinction (e.g. FGTS gating) call
 * `isFirstPartyAnthropicEndpoint(modelId)` separately.
 */
export function getProviderForModel(modelId: string): APIProvider {
  const conn = resolveConnectionForModel(modelId)
  if (!conn) return getAPIProvider()
  switch (conn.protocol) {
    case 'anthropic':
      return 'firstParty'
    case 'openai':
      return 'openai'
    case 'gemini':
      return 'gemini'
    case 'codex':
      return 'codex'
  }
}

/**
 * Is the request for `modelId` going to land on an api.anthropic.com
 * endpoint right now?
 *
 * This is the "deployment is genuinely first-party Anthropic" check that
 * gates native-only request body fields like `eager_input_streaming`
 * (FGTS) — proxies (LiteLLM, Helicone, etc.) speak the Anthropic
 * protocol but reject these fields with 400.
 *
 * Resolution order:
 *   1. If `modelId` resolves to a configured connection, check that
 *      connection's endpoint host.
 *   2. Otherwise (env-only path or no model in hand), fall back to the
 *      global provider + `ANTHROPIC_BASE_URL` host check.
 */
export function isFirstPartyAnthropicEndpoint(modelId?: string): boolean {
  if (modelId) {
    const conn = resolveConnectionForModel(modelId)
    if (conn) return isFirstPartyAnthropicConnection(conn)
    // No connection match — fall through to global path below.
  }
  return getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl()
}

/**
 * Pure-logic predicate: does (provider, model) support Anthropic's
 * server-side `web_search_20250305` tool?
 *
 * Mirrors ant's WebSearchTool.isEnabled() gating: firstParty / Bedrock
 * / Foundry always; Vertex only on Claude 4-series models (older
 * Claude 3.x deployments on Vertex don't expose the tool yet).
 *
 * Exported separately so callers without a stable resolver (tests,
 * dependency-injected paths) can ask the question directly.
 */
export function isAnthropicServerWebSearchCapable(
  provider: APIProvider,
  modelId?: string,
): boolean {
  switch (provider) {
    case 'firstParty':
    case 'bedrock':
    case 'foundry':
      return true
    case 'vertex':
      // Older Claude 3.x deployments on Vertex don't expose the
      // server tool — same restriction ant ships.
      if (!modelId) return false
      return /claude-(opus|sonnet|haiku)-4/i.test(modelId)
    default:
      return false
  }
}

/**
 * Whether the active provider supports Anthropic's server-side
 * `web_search_20250305` tool — used by WebSearchTool to pick between
 * the API-driven adapter and the Bing scraper fallback.
 */
export function supportsAnthropicServerWebSearch(modelId?: string): boolean {
  const provider = modelId ? getProviderForModel(modelId) : getAPIProvider()
  return isAnthropicServerWebSearchCapable(provider, modelId)
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
