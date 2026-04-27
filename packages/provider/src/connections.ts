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
