/**
 * Connection-based multi-provider architecture.
 *
 * Each connection represents a single authentication source — an OAuth account
 * (Claude, Codex), an API key endpoint (Ollama, DeepSeek, Grok), or a cloud
 * provider (Bedrock, Vertex). Connections are independent: logging in/out of
 * one does not affect any other.
 *
 * Connections are stored in GlobalConfig.connections[].
 */
import {
  getGlobalConfig,
  saveGlobalConfig,
  type ConnectionRecord,
  type ConnectionModelRecord,
} from '@claude-code/config'

// Re-export types from config for convenience
export type { ConnectionRecord, ConnectionModelRecord }
export type AuthProtocol = ConnectionRecord['protocol']

export type OAuthSource = 'claude-ai' | 'console' | 'codex'

// ── Default models per protocol ─────────────────────────────────────────

/** Default model lists when a connection doesn't specify custom models. */
export function getDefaultModelsForProtocol(
  protocol: AuthProtocol,
): ConnectionModelRecord[] {
  switch (protocol) {
    case 'anthropic':
      return [
        {
          id: 'claude-opus-4-7',
          label: 'Opus 4.7',
          description: 'Most capable for complex work',
        },
        {
          id: 'claude-sonnet-4-6',
          label: 'Sonnet 4.6',
          description: 'Best for everyday tasks',
        },
        {
          id: 'claude-haiku-4-5',
          label: 'Haiku 4.5',
          description: 'Fastest for quick answers',
        },
      ]
    case 'codex':
      return [
        {
          id: 'gpt-5.2-codex',
          label: 'GPT-5.2 Codex',
          description: 'Frontier agentic coding model',
        },
        {
          id: 'gpt-5.1-codex-max',
          label: 'GPT-5.1 Codex Max',
          description: 'Max Codex model',
        },
        {
          id: 'gpt-5.1-codex-mini',
          label: 'GPT-5.1 Codex Mini',
          description: 'Fast Codex model',
        },
      ]
    case 'openai':
      return [
        {
          id: 'gpt-4o',
          label: 'GPT-4o',
          description: 'Versatile, high intelligence',
        },
        {
          id: 'gpt-4o-mini',
          label: 'GPT-4o Mini',
          description: 'Fast and affordable',
        },
      ]
    case 'gemini':
      return [
        {
          id: 'gemini-2.5-pro',
          label: 'Gemini 2.5 Pro',
          description: 'Most capable Gemini model',
        },
        {
          id: 'gemini-2.5-flash',
          label: 'Gemini 2.5 Flash',
          description: 'Fast and versatile',
        },
      ]
  }
}

// ── Well-known connection IDs ───────────────────────────────────────────

export const CLAUDE_AI_CONNECTION_ID = 'claude-account'
export const CONSOLE_CONNECTION_ID = 'anthropic-console'
export const CODEX_CONNECTION_ID = 'chatgpt-codex'

// ── Helpers ─────────────────────────────────────────────────────────────

/** Generate a short unique ID for new connections. */
export function generateConnectionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'conn_'
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

/** Check if a connection ID is one of the well-known OAuth connections. */
export function isWellKnownConnection(id: string): boolean {
  return [CLAUDE_AI_CONNECTION_ID, CONSOLE_CONNECTION_ID, CODEX_CONNECTION_ID].includes(id)
}

// ── CRUD ────────────────────────────────────────────────────────────────

/** Retrieve all connections from config. */
export function getConnections(): ConnectionRecord[] {
  return getGlobalConfig().connections ?? []
}

/** Find a connection by ID. */
export function getConnection(id: string): ConnectionRecord | undefined {
  return getConnections().find(c => c.id === id)
}

/** Save or update a connection. Uses upsert semantics. */
export function saveConnection(connection: ConnectionRecord): void {
  saveGlobalConfig(current => {
    const existing = current.connections ?? []
    const idx = existing.findIndex(c => c.id === connection.id)
    const updated =
      idx >= 0
        ? [...existing.slice(0, idx), connection, ...existing.slice(idx + 1)]
        : [...existing, connection]
    return { ...current, connections: updated }
  })
}

/** Remove a connection by ID. */
export function removeConnection(id: string): void {
  saveGlobalConfig(current => ({
    ...current,
    connections: (current.connections ?? []).filter(c => c.id !== id),
  }))
}

/** Toggle a connection's enabled state. */
export function toggleConnection(id: string): void {
  saveGlobalConfig(current => ({
    ...current,
    connections: (current.connections ?? []).map(c =>
      c.id === id ? { ...c, enabled: !c.enabled } : c,
    ),
  }))
}

/** Get all enabled connections. */
export function getEnabledConnections(): ConnectionRecord[] {
  return getConnections().filter(c => c.enabled)
}

// ── Compatible-provider upsert ─────────────────────────────────────────
//
// "Anthropic Compatible" and "OpenAI Compatible" categories can hold
// MULTIPLE connections each (Ollama + DeepSeek + vLLM under OpenAI; one
// or more self-hosted proxies under Anthropic). The OAuth helper
// (upsertProtocolConnection) collapses by `(protocol, auth.type='oauth')`
// — wrong shape for api_key. For api_key connections the unique key is
// (protocol, name) — the user-supplied display name disambiguates.

/**
 * Upsert a compatible (api_key) connection by (protocol, name). If a
 * matching record exists, replace it; otherwise create a new one.
 *
 * Returns the resulting connection so callers can route immediately
 * to it (e.g., set as default, refresh model picker).
 */
export function upsertCompatibleConnection(input: {
  protocol: AuthProtocol
  name: string
  endpoint: string
  apiKey: string
  models?: ConnectionModelRecord[]
}): ConnectionRecord {
  const trimmedName = input.name.trim()
  if (!trimmedName) {
    throw new Error('Connection name is required for compatible providers.')
  }
  const existing = getConnections().find(
    c =>
      c.protocol === input.protocol &&
      c.auth.type === 'api_key' &&
      c.name.toLowerCase() === trimmedName.toLowerCase(),
  )
  const record: ConnectionRecord = {
    id: existing?.id ?? generateConnectionId(),
    name: trimmedName,
    protocol: input.protocol,
    endpoint: input.endpoint,
    auth: { type: 'api_key', key: input.apiKey },
    enabled: true,
    models:
      input.models && input.models.length > 0
        ? input.models
        : existing?.models ?? getDefaultModelsForProtocol(input.protocol),
    createdAt: existing?.createdAt ?? Date.now(),
  }
  saveConnection(record)
  return record
}

// ── Per-connection logout ──────────────────────────────────────────────
//
// `removeConnection(id)` deletes the record only. For OAuth records the
// token still lives in legacy global slots (`oauthAccount`, `codexOAuth`)
// — disconnecting must scrub those too, scoped to the connection's
// auth.source so other connections of the same protocol survive.

/**
 * Disconnect a single connection: delete the record and cleanup the
 * OAuth token slot if applicable. api_key connections store their key
 * inside the record itself, so deletion fully revokes them.
 *
 * Currently anthropic OAuth (claude-ai) and codex OAuth each have ONE
 * global slot — disconnecting wipes that slot. Future work: move OAuth
 * tokens onto `connection.auth.tokens` so multiple OAuth connections of
 * the same source can coexist (e.g., two Claude Accounts).
 */
export async function disconnectConnection(id: string): Promise<void> {
  const conn = getConnection(id)
  if (!conn) return

  if (conn.auth.type === 'oauth') {
    if (conn.auth.source === 'codex') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { saveCodexOAuthTokens } = require(
        '@claude-code/provider/oauth/codex-auth.js',
      ) as typeof import('@claude-code/provider/oauth/codex-auth.js')
      // No "delete" API; replace the slot with null/empty by saving
      // empty tokens and then letting removeConnection drop the record.
      // Better: clear the config field directly.
      saveGlobalConfig(c => ({ ...c, codexOAuth: undefined }))
      void saveCodexOAuthTokens
    } else if (conn.auth.source === 'claude-ai') {
      // Clear the upstream Anthropic OAuth slots (oauthAccount + the
      // managed primaryApiKey). Leave keychain untouched here — that's
      // owned by `userAuth.ts` and revoked via the existing /logout
      // path. v1 limitation: only one Claude Account at a time.
      saveGlobalConfig(c => ({
        ...c,
        oauthAccount: undefined,
        primaryApiKey: undefined,
      }))
    }
  }

  removeConnection(id)
}

// ── Legacy-config migration ────────────────────────────────────────────
//
// Pre-connections users configured providers via `settings.env.{ANTHROPIC,
// OPENAI,GEMINI}_*` + `settings.modelType`. Reading those still works
// (env-var fallback paths in adapters), but new code expects connection
// records. On startup we synthesize connection records from any legacy
// env so the model picker / connection manager surface them, without
// touching the legacy env (avoid breaking any external scripts that
// check those vars).

function migrateLegacyAnthropicCompat(env: Record<string, string>): boolean {
  const baseUrl = env.ANTHROPIC_BASE_URL
  const apiKey = env.ANTHROPIC_AUTH_TOKEN
  if (!baseUrl) return false
  // Heuristic: if a Claude Account OAuth connection already exists at
  // api.anthropic.com, that's the OAuth slot — only migrate when this
  // base URL is a different host.
  try {
    const host = new URL(baseUrl).host
    if (host === 'api.anthropic.com') return false
  } catch {
    return false
  }
  const existing = getConnections().find(
    c =>
      c.protocol === 'anthropic' &&
      c.auth.type === 'api_key' &&
      c.endpoint === baseUrl,
  )
  if (existing) return false
  const url = (() => {
    try {
      return new URL(baseUrl)
    } catch {
      return null
    }
  })()
  upsertCompatibleConnection({
    protocol: 'anthropic',
    name: url ? url.host : 'Anthropic Compatible (migrated)',
    endpoint: baseUrl,
    apiKey: apiKey ?? '',
    models: [
      env.ANTHROPIC_DEFAULT_OPUS_MODEL && {
        id: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
        label: `Opus (${env.ANTHROPIC_DEFAULT_OPUS_MODEL})`,
      },
      env.ANTHROPIC_DEFAULT_SONNET_MODEL && {
        id: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
        label: `Sonnet (${env.ANTHROPIC_DEFAULT_SONNET_MODEL})`,
      },
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL && {
        id: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
        label: `Haiku (${env.ANTHROPIC_DEFAULT_HAIKU_MODEL})`,
      },
    ].filter((m): m is ConnectionModelRecord => Boolean(m)),
  })
  return true
}

function migrateLegacyOpenAICompat(env: Record<string, string>): boolean {
  const baseUrl = env.OPENAI_BASE_URL
  const apiKey = env.OPENAI_API_KEY
  if (!baseUrl && !apiKey) return false
  const existing = getConnections().find(
    c =>
      c.protocol === 'openai' &&
      c.auth.type === 'api_key' &&
      c.endpoint === (baseUrl ?? ''),
  )
  if (existing) return false
  const endpoint = baseUrl ?? 'https://api.openai.com/v1'
  const url = (() => {
    try {
      return new URL(endpoint)
    } catch {
      return null
    }
  })()
  const models: ConnectionModelRecord[] = []
  if (env.OPENAI_DEFAULT_OPUS_MODEL) {
    models.push({ id: env.OPENAI_DEFAULT_OPUS_MODEL, label: env.OPENAI_DEFAULT_OPUS_MODEL })
  }
  if (env.OPENAI_DEFAULT_SONNET_MODEL) {
    models.push({ id: env.OPENAI_DEFAULT_SONNET_MODEL, label: env.OPENAI_DEFAULT_SONNET_MODEL })
  }
  if (env.OPENAI_DEFAULT_HAIKU_MODEL) {
    models.push({ id: env.OPENAI_DEFAULT_HAIKU_MODEL, label: env.OPENAI_DEFAULT_HAIKU_MODEL })
  }
  upsertCompatibleConnection({
    protocol: 'openai',
    name: url ? url.host : 'OpenAI Compatible (migrated)',
    endpoint,
    apiKey: apiKey ?? '',
    models: models.length > 0 ? models : undefined,
  })
  return true
}

function migrateLegacyGemini(env: Record<string, string>): boolean {
  const apiKey = env.GEMINI_API_KEY
  if (!apiKey) return false
  const baseUrl = env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta'
  const existing = getConnections().find(
    c => c.protocol === 'gemini' && c.auth.type === 'api_key',
  )
  if (existing) return false
  const url = (() => {
    try {
      return new URL(baseUrl)
    } catch {
      return null
    }
  })()
  const models: ConnectionModelRecord[] = []
  if (env.GEMINI_DEFAULT_OPUS_MODEL) {
    models.push({ id: env.GEMINI_DEFAULT_OPUS_MODEL, label: env.GEMINI_DEFAULT_OPUS_MODEL })
  }
  if (env.GEMINI_DEFAULT_SONNET_MODEL) {
    models.push({ id: env.GEMINI_DEFAULT_SONNET_MODEL, label: env.GEMINI_DEFAULT_SONNET_MODEL })
  }
  if (env.GEMINI_DEFAULT_HAIKU_MODEL) {
    models.push({ id: env.GEMINI_DEFAULT_HAIKU_MODEL, label: env.GEMINI_DEFAULT_HAIKU_MODEL })
  }
  upsertCompatibleConnection({
    protocol: 'gemini',
    name: url ? url.host : 'Gemini API (migrated)',
    endpoint: baseUrl,
    apiKey,
    models: models.length > 0 ? models : undefined,
  })
  return true
}

/**
 * Migrate legacy env-driven config into connection records on first run
 * after upgrade. Idempotent: if a connection already exists for the
 * legacy env values, no-op. Does NOT delete the env — external scripts
 * may still depend on it, and adapters fall back to env when no
 * connection matches.
 *
 * Called once at boot (see app-host/init.ts).
 */
export function migrateLegacyEnvToConnections(
  envSource: Record<string, string>,
): { migrated: string[] } {
  const migrated: string[] = []
  if (migrateLegacyAnthropicCompat(envSource)) migrated.push('anthropic')
  if (migrateLegacyOpenAICompat(envSource)) migrated.push('openai')
  if (migrateLegacyGemini(envSource)) migrated.push('gemini')
  return { migrated }
}
