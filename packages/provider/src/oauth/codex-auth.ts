/**
 * Codex OAuth token storage and retrieval.
 *
 * Codex tokens are stored in the GlobalConfig JSON file (not in the system
 * keychain) and are only ever sent to OpenAI's API, never to Anthropic's
 * servers. This is completely separate from Anthropic's claudeAiOauth
 * keychain entry.
 */
import { getGlobalConfig, saveGlobalConfig } from '@claude-code/config'
import type { CodexTokens } from './codex-client.js'
import { isOAuthTokenExpired } from './client.js'
import { refreshCodexToken } from './codex-client.js'
export type StoredCodexTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId: string
}

/**
 * Saves the OpenAI Codex OAuth tokens to GlobalConfig.
 * Does NOT overwrite or interfere with Anthropic's claudeAiOauth block.
 */
export function saveCodexOAuthTokens(tokens: CodexTokens): void {
  saveGlobalConfig((cfg) => ({
    ...cfg,
    codexOAuth: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      accountId: tokens.accountId,
    },
  }))
}

/**
 * Retrieves the stored Codex OAuth tokens from GlobalConfig.
 * Returns null if no Codex tokens are stored.
 */
export function getCodexOAuthTokens(): StoredCodexTokens | null {
  const cfg = getGlobalConfig()
  const stored = cfg.codexOAuth
  if (
    !stored?.accessToken ||
    !stored.refreshToken ||
    !stored.expiresAt ||
    !stored.accountId
  ) {
    return null
  }
  return stored
}

/**
 * Refreshes the Codex access token if it has expired or is about to expire.
 * Returns the current valid access token.
 */
export async function checkAndRefreshCodexTokenIfNeeded(): Promise<string | null> {
  const tokens = getCodexOAuthTokens()
  if (!tokens) return null

  if (isOAuthTokenExpired(tokens.expiresAt)) {
    try {
      const refreshed = await refreshCodexToken(tokens.refreshToken)
      saveCodexOAuthTokens(refreshed)
      return refreshed.accessToken
    } catch {
      // Refresh failed — token may still work for a while
      return tokens.accessToken
    }
  }

  return tokens.accessToken
}
