/**
 * Self-contained OpenAI Codex OAuth 2.0 PKCE client.
 *
 * This module handles the complete Codex login flow independently of the
 * Anthropic OAuth client (client.ts). It manages:
 * - PKCE challenge generation
 * - A local HTTP server on port 1455 (required by OpenAI's registered redirect URI)
 * - Authorization URL construction
 * - Code exchange for access + refresh tokens
 * - Account ID extraction from the returned JWT
 * - Token refresh
 *
 * Based on the implementation in @mariozechner/pi-ai/dist/utils/oauth/openai-codex.js
 * used by the openclaw project.
 */
import { createServer, type Server } from 'http'
import { logEvent } from '@claude-code/local-observability'
import {
  CODEX_AUTHORIZE_URL,
  CODEX_CLIENT_ID,
  CODEX_JWT_AUTH_CLAIM,
  CODEX_REDIRECT_URI,
  CODEX_SCOPES,
  CODEX_TOKEN_URL,
} from './codex-constants.js'
import { openBrowser } from '@claude-code/storage/browser.js'
import { logError } from '@claude-code/local-observability/logging'
import { generateCodeChallenge, generateCodeVerifier, generateState } from './crypto.js'

// ── Types ────────────────────────────────────────────────────────────────────

export type CodexTokens = {
  /** OpenAI access token (JWT) */
  accessToken: string
  /** OpenAI refresh token */
  refreshToken: string
  /** Absolute epoch timestamp (ms) when the access token expires */
  expiresAt: number
  /** ChatGPT account ID extracted from the JWT */
  accountId: string
}

type TokenSuccessResult = {
  type: 'success'
  access: string
  refresh: string
  expires: number
}

type TokenFailedResult = {
  type: 'failed'
}

type TokenResult = TokenSuccessResult | TokenFailedResult

type LocalServer = {
  waitForCode: () => Promise<{ code: string } | null>
  cancelWait: () => void
  close: () => void
}

// ── JWT helpers ───────────────────────────────────────────────────────────────

/**
 * Decodes the payload from a JWT token.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1] ?? ''
    const decoded = Buffer.from(payload, 'base64url').toString('utf8')
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Extracts the ChatGPT account ID from the OpenAI access token JWT.
 * The account ID lives at payload["https://api.openai.com/auth"].chatgpt_account_id
 */
export function extractCodexAccountId(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken)
  if (!payload) return null
  const authClaim = payload[CODEX_JWT_AUTH_CLAIM]
  if (!authClaim || typeof authClaim !== 'object') return null
  const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : null
}

// ── Authorization URL ─────────────────────────────────────────────────────────

/**
 * Builds the OpenAI authorization URL with PKCE parameters.
 * Returns the URL plus the code verifier (needed for token exchange) and state.
 */
export function buildCodexAuthUrl(): {
  url: string
  verifier: string
  state: string
} {
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  const state = generateState()

  const url = new URL(CODEX_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CODEX_CLIENT_ID)
  url.searchParams.set('redirect_uri', CODEX_REDIRECT_URI)
  url.searchParams.set('scope', CODEX_SCOPES)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  // OpenAI-specific parameters (matched from the pi-ai implementation)
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'my-claude-code')

  return { url: url.toString(), verifier, state }
}

// ── Token Exchange & Refresh ──────────────────────────────────────────────────

async function postToTokenUrl(body: URLSearchParams): Promise<TokenResult> {
  try {
    const response = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      logError(
        new Error(
          `[codex-oauth] token endpoint responded ${response.status}: ${text}`,
        ),
      )
      return { type: 'failed' }
    }
    const json = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
      logError(new Error('[codex-oauth] token response missing required fields'))
      return { type: 'failed' }
    }
    return {
      type: 'success',
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + json.expires_in * 1000,
    }
  } catch (err) {
    logError(err as Error)
    return { type: 'failed' }
  }
}

/**
 * Exchanges an authorization code for access + refresh tokens.
 */
export async function exchangeCodexCode(
  code: string,
  verifier: string,
): Promise<CodexTokens> {
  const result = await postToTokenUrl(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CODEX_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: CODEX_REDIRECT_URI,
    }),
  )
  if (result.type !== 'success') {
    throw new Error('Codex token exchange failed. Please try again.')
  }
  const accountId = extractCodexAccountId(result.access)
  if (!accountId) {
    throw new Error('Failed to extract accountId from Codex token.')
  }
  return {
    accessToken: result.access,
    refreshToken: result.refresh,
    expiresAt: result.expires,
    accountId,
  }
}

/**
 * Refreshes an expired Codex access token.
 */
export async function refreshCodexToken(refreshToken: string): Promise<CodexTokens> {
  const result = await postToTokenUrl(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CODEX_CLIENT_ID,
    }),
  )
  if (result.type !== 'success') {
    throw new Error('Codex token refresh failed. Please re-login.')
  }
  const accountId = extractCodexAccountId(result.access)
  if (!accountId) {
    throw new Error('Failed to extract accountId from refreshed Codex token.')
  }
  return {
    accessToken: result.access,
    refreshToken: result.refresh,
    expiresAt: result.expires,
    accountId,
  }
}

// ── Local Callback Server ─────────────────────────────────────────────────────

/**
 * Starts a local HTTP server on port 1455 to capture the OAuth callback.
 * Port 1455 is fixed — it is hardcoded in OpenAI's registered redirect URI
 * for Codex CLI tools (http://localhost:1455/auth/callback).
 *
 * Falls back gracefully if port 1455 is already in use (the user will need
 * to paste the redirect URL manually).
 */
export async function startCodexCallbackServer(expectedState: string): Promise<LocalServer> {
  let settleWait: ((value: { code: string } | null) => void) | null = null
  let server: Server | null = null

  const waitPromise = new Promise<{ code: string } | null>((resolve) => {
    settleWait = resolve
  })

  const doClose = () => {
    if (server) {
      server.removeAllListeners()
      server.close()
      server = null
    }
  }

  const localServer: LocalServer = {
    waitForCode: () => waitPromise,
    cancelWait: () => {
      settleWait?.(null)
      settleWait = null
    },
    close: doClose,
  }

  return new Promise<LocalServer>((resolve) => {
    const s = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost')
        if (url.pathname !== '/auth/callback') {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        const stateParam = url.searchParams.get('state')
        if (stateParam !== expectedState) {
          res.writeHead(400)
          res.end('State mismatch')
          return
        }
        const code = url.searchParams.get('code')
        if (!code) {
          res.writeHead(400)
          res.end('Missing authorization code')
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          '<html><body><h2>✅ OpenAI authentication completed.</h2><p>You can close this window and return to your terminal.</p></body></html>',
        )
        settleWait?.({ code })
        settleWait = null
      } catch {
        res.writeHead(500)
        res.end('Internal error')
      }
    })

    server = s

    s.listen(1455, '127.0.0.1', () => {
      resolve(localServer)
    }).on('error', () => {
      // Port 1455 is busy — resolve with a server that always returns null
      // so the user falls back to manual paste.
      resolve({
        waitForCode: async () => null,
        cancelWait: () => {},
        close: () => {},
      })
    })
  })
}

// ── Full OAuth Flow ───────────────────────────────────────────────────────────

/**
 * Parses a manually pasted callback input (could be the full redirect URL
 * or just the raw code).
 */
function parseCodexCallbackInput(
  input: string,
  expectedState: string,
): { code: string | undefined } {
  const value = input.trim()
  if (!value) return { code: undefined }

  try {
    const url = new URL(value)
    const urlState = url.searchParams.get('state')
    if (urlState && urlState !== expectedState) {
      throw new Error('State mismatch in pasted URL')
    }
    return { code: url.searchParams.get('code') ?? undefined }
  } catch {
    // Not a URL — treat as raw code
  }

  if (value.includes('code=')) {
    const params = new URLSearchParams(value)
    return { code: params.get('code') ?? undefined }
  }

  return { code: value }
}

/**
 * Runs the complete Codex OAuth 2.0 PKCE flow:
 * 1. Builds the authorization URL
 * 2. Starts a local callback server on port 1455
 * 3. Opens the browser
 * 4. Waits for the callback (or manual paste via onManualInput)
 * 5. Exchanges the code for tokens
 * 6. Returns the CodexTokens
 *
 * @param onUrlReady - Called with the auth URL so the UI can display it
 * @param onManualInput - Optional: resolves with the pasted redirect URL/code
 */
export async function runCodexOAuthFlow(
  onUrlReady: (url: string) => Promise<void>,
  onManualInput?: () => Promise<string>,
): Promise<CodexTokens> {
  const { url, verifier, state } = buildCodexAuthUrl()
  const callbackServer = await startCodexCallbackServer(state)

  logEvent('tengu_oauth_codex_flow_start', {})

  try {
    await onUrlReady(url)
    await openBrowser(url)

    let code: string | undefined

    if (onManualInput) {
      // Race: browser callback vs. manual paste
      const manualPromise = onManualInput().then((input) => {
        callbackServer.cancelWait()
        return input
      })

      const callbackResult = await callbackServer.waitForCode()
      if (callbackResult?.code) {
        code = callbackResult.code
      } else {
        // Callback didn't arrive — use manual input
        const manualInput = await manualPromise
        const parsed = parseCodexCallbackInput(manualInput, state)
        code = parsed.code
      }
    } else {
      const callbackResult = await callbackServer.waitForCode()
      code = callbackResult?.code
    }

    if (!code) {
      throw new Error('No authorization code received from Codex OAuth flow.')
    }

    logEvent('tengu_oauth_codex_code_received', {})
    const tokens = await exchangeCodexCode(code, verifier)
    logEvent('tengu_oauth_codex_success', {})
    return tokens
  } catch (err) {
    logEvent('tengu_oauth_codex_error', {})
    throw err
  } finally {
    callbackServer.close()
  }
}
