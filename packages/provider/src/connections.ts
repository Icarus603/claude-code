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
import { performLogout } from './commands/logout/logout.js'

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
      // Mirror of what `https://chatgpt.com/backend-api/codex/models` returns
      // for ChatGPT-account auth as of 2026-04-27. We do not call /models
      // at runtime: that endpoint requires us to impersonate the openai/codex
      // Rust CLI's own `client_version` (the only accepted version space is
      // sub-1.0.0, the codex CLI's), and the tier-filter behavior varies
      // unpredictably across versions — it dropped `gpt-5.5` against
      // `client_version=0.125.0` (the latest codex-rs release tag) but
      // returned it for an older value. Static-list-as-mirror is the
      // pragmatic answer: when OpenAI ships a new model we add the entry
      // here, same way openai/codex used to maintain its preset list.
      //
      // Sync source: /models response on a Plus account, hand-verified.
      // openai/codex itself removed its hardcoded ModelPreset registry
      // in favor of this same dynamic endpoint, so there's no upstream
      // table to mirror more directly.
      //
      // If the user's plan tier doesn't include one of these models the
      // /responses call returns a clear `model not available` error.
      return [
        {
          id: 'gpt-5.5',
          label: 'GPT-5.5',
          description:
            'Frontier model for complex coding, research, and real-world work.',
          supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultEffort: 'medium',
        },
        {
          id: 'gpt-5.4',
          label: 'GPT-5.4',
          description: 'Strong model for everyday coding.',
          supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultEffort: 'medium',
        },
        {
          id: 'gpt-5.4-mini',
          label: 'GPT-5.4 Mini',
          description:
            'Small, fast, and cost-efficient model for simpler coding tasks.',
          supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultEffort: 'medium',
        },
        {
          id: 'gpt-5.3-codex',
          label: 'GPT-5.3 Codex',
          description: 'Coding-optimized model.',
          supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultEffort: 'medium',
        },
        {
          id: 'gpt-5.2',
          label: 'GPT-5.2',
          description:
            'Optimized for professional work and long-running agents.',
          supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
          defaultEffort: 'medium',
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

// ── Composite model ids (connection-aware routing) ────────────────────
//
// When multiple connections expose the same model name (e.g., Claude
// Account and an Anthropic Compatible proxy both have
// `claude-opus-4-7`), the model picker emits `<connectionId>:<modelId>`
// so settings.mainLoopModel disambiguates which connection to use.
//
// Adapters call `unpackModelId(model)` at the API seam to strip the
// prefix before sending the bare model name upstream.

const MODEL_ID_SEPARATOR = ':'

/**
 * Build a composite id from a connection id + bare model id.
 * Returns the bare model id if no connection (legacy path).
 */
export function composeModelId(
  connectionId: string | undefined,
  modelId: string,
): string {
  if (!connectionId) return modelId
  return `${connectionId}${MODEL_ID_SEPARATOR}${modelId}`
}

/**
 * Split a composite model id into its parts. Returns the bare model id
 * unchanged when no separator is present (legacy / env-only path).
 */
export function unpackModelId(value: string): {
  connectionId: string | undefined
  modelId: string
} {
  const idx = value.indexOf(MODEL_ID_SEPARATOR)
  if (idx <= 0) return { connectionId: undefined, modelId: value }
  const head = value.slice(0, idx)
  // Connection ids are alphanumeric (`conn_xxxxxxxx` or well-known
  // ids like `claude-account`); reject if the head contains a slash or
  // dot (those are model paths like `models/gemini-2.5-pro`).
  if (/[/.]/.test(head)) return { connectionId: undefined, modelId: value }
  return { connectionId: head, modelId: value.slice(idx + 1) }
}

/**
 * User-facing display label for a connection model.
 *
 * Migration code (`migrateLegacyAnthropicCompat`) stores labels as
 * `Alias (wire-id)` — e.g. "Opus (deepseek-v4-pro[1m])". That alias
 * prefix is meaningless once the row exists (the wire route is the id;
 * the alias is just the env var that pointed at it), and worse it
 * becomes noisy when the user maps multiple aliases at the same id
 * (collapse-by-id leaves the prefix arbitrary).
 *
 * Strip the alias and show the wire id directly when we detect that
 * format. Native records (Claude Account "Opus 4.7", Codex "GPT-5.5")
 * have no parens and pass through verbatim.
 *
 * Single source of truth — picker, /model picker confirmation, and the
 * header banner all call this so the displayed name is consistent.
 */
export function prettyModelLabel(model: ConnectionModelRecord): string {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(model.label.trim())
  if (m && m[2]!.trim() === model.id) return model.id
  return model.label
}

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
 *
 * If this disconnect leaves zero connections (i.e. user logged out of
 * the last provider), fall through to `performLogout()` for full
 * global cleanup: secure storage wipe, keychain Anthropic key removal,
 * caches reset (betas/policy/grove/oauth), `oauthAccount` clear. Without
 * this fall-through, partial state would linger across the
 * "all-providers-logged-out" boundary — semantically the user is
 * logged out, but the indicator/auth code would still see stale traces.
 */
export async function disconnectConnection(id: string): Promise<void> {
  const conn = getConnection(id)
  if (!conn) return

  if (conn.auth.type === 'oauth') {
    if (conn.auth.source === 'codex') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { saveCodexOAuthTokens } = require(
        './oauth/codex-auth.js',
      ) as typeof import('./oauth/codex-auth.js')
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

  // Last-connection global cleanup: when the user disconnects the last
  // remaining connection, semantically they're fully logged out — wipe
  // secure storage, keychain Anthropic key, oauthAccount, and all auth
  // caches (betas/policy/grove/oauth-tokens) so no stale state lingers.
  if (getConnections().length === 0) {
    await performLogout({ clearOnboarding: false })
  }
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
): { migrated: string[]; clearedModelType: boolean } {
  const migrated: string[] = []
  if (migrateLegacyAnthropicCompat(envSource)) migrated.push('anthropic')
  if (migrateLegacyOpenAICompat(envSource)) migrated.push('openai')
  if (migrateLegacyGemini(envSource)) migrated.push('gemini')

  // V7 §11.6 — clear stale legacy settings when connections are present.
  //
  // `settings.modelType` was the legacy global routing knob ('anthropic' /
  // 'openai' / 'gemini'). Routing is now per-connection — keeping this
  // field makes getAPIProvider() return the wrong global provider, causing
  // getDefaultOpusModel() to fall into the 3P branch and return opus46.
  //
  // `settings.mainLoopModel` may contain a bare model id (e.g.
  // 'claude-sonnet-4-5') that doesn't match any connection's model list.
  // The header then renders it as the stale bare name ("Sonnet 4.5")
  // instead of going through the connection resolver. Clearing it here
  // lets the system fall back to the connection default on next load.
  let clearedModelType = false
  if (getConnections().length > 0) {
    try {
      // require-fallback: settings module loaded lazily to avoid the
      // provider→config bootstrap cycle. Catch swallows because this
      // path is best-effort migration; failure leaves the user with
      // stale modelType that the resolver can still degrade gracefully.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSettings, updateSettingsForSource } = require(
        '@claude-code/config/settings',
      ) as typeof import('@claude-code/config/settings')
      const userSettings = getSettings() as {
        modelType?: unknown
        mainLoopModel?: unknown
      } | undefined
      const clearPayload: Record<string, undefined> = {}
      if (userSettings?.modelType) clearPayload.modelType = undefined
      // Clear mainLoopModel only when it holds a bare model id that isn't
      // prefixed with a connection id (i.e. from the pre-connection era).
      // Prefixed ids ('conn_xxx:claude-opus-4-7') are fine to keep.
      const mlm = userSettings?.mainLoopModel
      if (typeof mlm === 'string' && !mlm.includes(':')) {
        // Check if this bare id belongs to any enabled connection's model
        // list. If not, it's stale and should be cleared so the connection
        // default takes over.
        const allModelIds = getConnections().flatMap(c => c.models.map(m => m.id))
        if (!allModelIds.includes(mlm)) {
          clearPayload.mainLoopModel = undefined
        }
      }
      if (Object.keys(clearPayload).length > 0) {
        updateSettingsForSource('userSettings', clearPayload as never)
        clearedModelType = 'modelType' in clearPayload
      }
    } catch {
      // Migration is best-effort; never block boot.
    }

    // Earlier Codex login flows wrote `CLAUDE_CODE_USE_OPENAI=1` into
    // `globalConfig.env` to force the OpenAI dispatch branch. With
    // per-connection routing that flag is now actively harmful: it makes
    // Claude models on a coexisting Claude Account connection 401 against
    // api.openai.com. When a Codex connection exists, scrub the
    // legacy flag from the persisted config so subsequent boots route by
    // model id only.
    const hasCodex = getConnections().some(c => c.protocol === 'codex')
    if (hasCodex) {
      try {
        saveGlobalConfig(current => {
          const env = current.env ?? {}
          if (env.CLAUDE_CODE_USE_OPENAI !== '1') return current
          const { CLAUDE_CODE_USE_OPENAI: _drop, ...rest } = env
          void _drop
          return { ...current, env: rest }
        })
        // require-fallback: env utils lazy-loaded to dodge bootstrap
        // ordering. Best-effort flag scrub — leaving the legacy flag in
        // place only causes a 401 the resolver already handles.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readEnv, deleteEnv } = require(
          '@claude-code/config/env/utils',
        ) as typeof import('@claude-code/config/env/utils')
        if (readEnv('CLAUDE_CODE_USE_OPENAI') === '1') {
          deleteEnv('CLAUDE_CODE_USE_OPENAI')
        }
      } catch {
        // Best-effort; never block boot.
      }
    }
  }

  return { migrated, clearedModelType }
}
