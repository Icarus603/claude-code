/**
 * OpenAI Codex OAuth constants.
 *
 * These values are extracted from the @mariozechner/pi-ai package used by the
 * openclaw project. The Codex OAuth flow uses OpenAI's own auth server at
 * auth.openai.com and is completely separate from Anthropic's OAuth flow.
 *
 * References:
 * - Client ID: app_EMoamEEZ73f0CkXaXp7hrann
 * - Authorize URL: https://auth.openai.com/oauth/authorize
 * - Token URL: https://auth.openai.com/oauth/token
 * - Redirect URI: http://localhost:1455/auth/callback (fixed port per OpenAI's registration)
 */

/** The registered OAuth client ID for Codex CLI tools */
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

/** OpenAI's authorization endpoint */
export const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'

/** OpenAI's token exchange / refresh endpoint */
export const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'

/**
 * The redirect URI registered for the Codex OAuth app.
 * OpenAI requires a fixed port (1455) — unlike Anthropic which uses OS-assigned ports.
 */
export const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback'

/** Space-separated OAuth scopes requested from OpenAI */
export const CODEX_SCOPES = 'openid profile email offline_access'

/**
 * JWT claim namespace where OpenAI places the chatgpt_account_id.
 * The account ID is extracted from the access token JWT:
 *   payload["https://api.openai.com/auth"].chatgpt_account_id
 */
export const CODEX_JWT_AUTH_CLAIM = 'https://api.openai.com/auth'

/**
 * Provider identifier used in config storage to distinguish Codex credentials
 * from Anthropic credentials.
 */
export const CODEX_PROVIDER_ID = 'openai-codex' as const
