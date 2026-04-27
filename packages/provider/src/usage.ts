import axios from 'axios'
import { getOauthConfig } from '@claude-code/provider/oauthConstants'
import {
  getClaudeAIOAuthTokens,
  hasProfileScope,
  isClaudeAISubscriber,
} from '@claude-code/provider/authAlias.js'
import {
  checkAndRefreshCodexTokenIfNeeded,
  getCodexOAuthTokens,
} from '@claude-code/provider/oauth/codex-auth.js'
import { getAuthHeaders } from '@claude-code/provider/http.js'
import { getClaudeCodeUserAgent } from '@claude-code/provider/userAgent.js'
import { isOAuthTokenExpired } from '@claude-code/provider/oauth/client.js'

export type RateLimit = {
  utilization: number | null // a percentage from 0 to 100
  resets_at: string | null // ISO 8601 timestamp
}

export type ExtraUsage = {
  is_enabled: boolean
  monthly_limit: number | null
  used_credits: number | null
  utilization: number | null
}

/**
 * ChatGPT-account codex usage. Mirrors `chatgpt.com/wham/usage`
 * response, simplified to the fields we render. `primary` is the 5-hour
 * window, `secondary` is the 7-day window. Codex returns reset_at as
 * unix-seconds; we normalize to ISO so the UI's `formatCountdown` works
 * the same for both providers.
 */
export type CodexUtilization = {
  primary?: RateLimit | null
  secondary?: RateLimit | null
  plan_type?: string | null
  credits_balance?: string | null
}

export type Utilization = {
  five_hour?: RateLimit | null
  seven_day?: RateLimit | null
  seven_day_oauth_apps?: RateLimit | null
  seven_day_opus?: RateLimit | null
  seven_day_sonnet?: RateLimit | null
  extra_usage?: ExtraUsage | null
  /**
   * Populated when a Codex OAuth connection is present. UIs that show
   * usage render this as a separate "ChatGPT Codex" block alongside the
   * Anthropic windows above.
   */
  codex?: CodexUtilization | null
}

// Codex's usage endpoint lives under the same `/backend-api/codex/`
// namespace as `/responses` and `/models`. The reference impl we
// mirrored had the path without `/backend-api`, which 404s on the live
// chatgpt.com host. The chatgpt-account auth headers (Bearer +
// ChatGPT-Account-Id) are identical to the other codex endpoints.
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/codex/usage'

type CodexUsageWindow = {
  used_percent?: number | null
  reset_at?: number | null
}

type CodexUsageResponse = {
  plan_type?: string | null
  rate_limit?: {
    primary_window?: CodexUsageWindow | null
    secondary_window?: CodexUsageWindow | null
  } | null
  credits?: {
    has_credits?: boolean | null
    unlimited?: boolean | null
    balance?: string | null
  } | null
}

function unixSecondsToIsoString(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value * 1000).toISOString()
}

function mapCodexWindow(window: CodexUsageWindow | null | undefined): RateLimit | null {
  if (!window) return null
  return {
    utilization:
      typeof window.used_percent === 'number' ? window.used_percent : null,
    resets_at: unixSecondsToIsoString(window.reset_at),
  }
}

async function fetchCodexUtilization(): Promise<CodexUtilization | null> {
  const tokens = getCodexOAuthTokens()
  if (!tokens) return null
  // Refresh if needed, just like /responses does — usage and responses
  // share the same Bearer token + ChatGPT-Account-Id header pair.
  const accessToken = await checkAndRefreshCodexTokenIfNeeded()
  if (!accessToken) return null
  const accountId = getCodexOAuthTokens()?.accountId ?? tokens.accountId
  try {
    const response = await axios.get<CodexUsageResponse>(CODEX_USAGE_URL, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'ChatGPT-Account-Id': accountId,
        'Content-Type': 'application/json',
        'User-Agent': getClaudeCodeUserAgent(),
      },
      timeout: 5000,
    })
    const data = response.data
    return {
      primary: mapCodexWindow(data.rate_limit?.primary_window),
      secondary: mapCodexWindow(data.rate_limit?.secondary_window),
      plan_type: data.plan_type ?? null,
      credits_balance: data.credits?.balance ?? null,
    }
  } catch {
    // Best-effort — codex usage failure must not break /status.
    return null
  }
}

async function fetchAnthropicUtilization(): Promise<Utilization | null> {
  if (!isClaudeAISubscriber() || !hasProfileScope()) {
    return {}
  }

  // Skip API call if OAuth token is expired to avoid 401 errors
  const tokens = getClaudeAIOAuthTokens()
  if (tokens && isOAuthTokenExpired(tokens.expiresAt)) {
    return null
  }

  const authResult = getAuthHeaders()
  if (authResult.error) {
    throw new Error(`Auth error: ${authResult.error}`)
  }

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': getClaudeCodeUserAgent(),
    ...authResult.headers,
  }

  const url = `${getOauthConfig().BASE_API_URL}/api/oauth/usage`

  const response = await axios.get<Utilization>(url, {
    headers,
    timeout: 5000, // 5 second timeout
  })

  return response.data
}

/**
 * Fetch both Anthropic and Codex usage in parallel and merge into one
 * `Utilization` payload. Each side fails open: missing tokens or
 * network errors yield no block on that side, never block the other.
 */
export async function fetchUtilization(): Promise<Utilization | null> {
  const [anthropic, codex] = await Promise.all([
    fetchAnthropicUtilization().catch(() => null),
    fetchCodexUtilization().catch(() => null),
  ])
  if (!anthropic && !codex) return null
  return { ...(anthropic ?? {}), codex: codex ?? undefined }
}
