import { useCallback, useState } from 'react'
import { getIsNonInteractiveSession } from '@claude-code/app-host/bootstrap/state.js'
import { verifyApiKey } from '@claude-code/provider/claude.js'
import {
  getAnthropicApiKeyWithSource,
  getApiKeyFromApiKeyHelper,
  getClaudeAIOAuthTokens,
} from '@claude-code/provider/authAlias.js'
import { getEnabledConnections } from '@claude-code/provider/connections.js'
import { getCodexOAuthTokens } from '@claude-code/provider/oauth/codex-auth.js'

export type VerificationStatus =
  | 'loading'
  | 'valid'
  | 'invalid'
  | 'missing'
  | 'error'

type ApiKeyVerificationResult = {
  status: VerificationStatus
  reverify: () => Promise<void>
  error: Error | null
}

/**
 * Status-indicator policy: ccb is "logged in" iff any enabled connection
 * has usable credentials.
 *
 * V7 §11.6 introduced the connection registry — Anthropic OAuth, Codex
 * OAuth, OpenAI/Gemini-compatible API-key endpoints, and self-hosted
 * Anthropic-compatible proxies coexist as independent connections. The
 * status indicator is a coarse "is this ccb installation usable for
 * anything" health check; it should NOT depend on which specific provider
 * the active model routes to (that would mean spurious "Not logged in"
 * warnings every time the user switches model).
 *
 * For each enabled connection:
 *   - api_key connections are authenticated iff `auth.key` is non-empty
 *     (the key is stored in the record itself).
 *   - oauth connections check the per-protocol token store
 *     (Codex: `getCodexOAuthTokens()`; Anthropic claude-ai:
 *      `getClaudeAIOAuthTokens()`).
 *
 * Legacy fallback: if no connection registry is set up but the user has
 * an Anthropic API key from env var / apiKeyHelper / settings, treat that
 * as logged in too — preserves the pre-V7 single-provider experience.
 */
function hasAnyAuthenticatedConnection(): boolean {
  for (const conn of getEnabledConnections()) {
    if (conn.auth.type === 'api_key') {
      if (conn.auth.key && conn.auth.key.length > 0) return true
    } else if (conn.auth.type === 'oauth') {
      if (conn.auth.source === 'codex') {
        if (getCodexOAuthTokens()) return true
      } else if (conn.auth.source === 'claude-ai') {
        if (getClaudeAIOAuthTokens()) return true
      } else {
        // Unknown OAuth source — treat presence of the connection record
        // as good enough; the actual API call will surface auth errors.
        return true
      }
    }
  }
  // Legacy fallback: env-var / apiKeyHelper / settings Anthropic key.
  // skipRetrievingKeyFromApiKeyHelper avoids executing apiKeyHelper before
  // trust dialog is shown (security: prevents RCE via settings.json).
  const { key, source } = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  if (key) return true
  if (source === 'apiKeyHelper') return true
  return false
}

export function useApiKeyVerification(): ApiKeyVerificationResult {
  const [status, setStatus] = useState<VerificationStatus>(() => {
    if (hasAnyAuthenticatedConnection()) {
      // Found credentials somewhere. We still verify the Anthropic key
      // asynchronously below if one exists (it may be expired); for the
      // initial paint, "valid" is the right default to avoid a flash of
      // "Not logged in" while async verify runs.
      return 'valid'
    }
    return 'missing'
  })
  const [error, setError] = useState<Error | null>(null)

  const verify = useCallback(async (): Promise<void> => {
    if (!hasAnyAuthenticatedConnection()) {
      setStatus('missing')
      return
    }
    // Warm the apiKeyHelper cache (no-op if not configured), then check
    // again in case it surfaces a key the static check couldn't see.
    await getApiKeyFromApiKeyHelper(getIsNonInteractiveSession())
    const { key: apiKey } = getAnthropicApiKeyWithSource()

    // If we have an Anthropic key, validate it against the API. This is the
    // only verification we can do client-side — Codex/OpenAI/Gemini keys
    // would each need their own verify endpoint (left for follow-up).
    if (apiKey) {
      try {
        const isValid = await verifyApiKey(apiKey, false)
        setStatus(isValid ? 'valid' : 'invalid')
        return
      } catch (e) {
        // API call failed but it's not necessarily an invalid-key error.
        // Mark as 'error' and surface the message; the user has at least
        // ONE authenticated connection (our gate above) so don't fall back
        // to 'missing'.
        setError(e as Error)
        setStatus('error')
        return
      }
    }

    // No Anthropic key but some other connection is authenticated — call
    // it valid. We can't verify Codex/OpenAI/Gemini auth without making a
    // model-specific roundtrip; the actual API call at first prompt time
    // will surface auth failures.
    setStatus('valid')
  }, [])

  return {
    status,
    reverify: verify,
    error,
  }
}
