/**
 * Anthropic team-onboarding share API — ported from ant v2.1.132 sx7
 * (3903.js dp7 / zG8 / cp7) + v2.1.136 mg7 / IL8 / pg7.
 *
 * Wire-protocol surface:
 *
 *   POST    /api/organizations/{orgUUID}/claude_code/onboarding
 *           body: { content, name? } → { short_code, share_url, ... }
 *   PUT     /api/organizations/{orgUUID}/claude_code/onboarding/{short_code}
 *           body: { content } → { short_code, share_url, ... }
 *   DELETE  /api/organizations/{orgUUID}/claude_code/onboarding/{short_code}
 *   GET     /api/organizations/{orgUUID}/claude_code/onboarding
 *           → Array<{ short_code, share_url, updated_at, ... }>
 *
 * Auth headers:
 *   Authorization: Bearer <accessToken>
 *   anthropic-beta: <gw header>
 */
import axios from 'axios'
import { logEvent } from '@claude-code/local-observability'
import { getOauthConfig, OAUTH_BETA_HEADER } from '@claude-code/provider/oauthConstants'
import { getClaudeAIOAuthTokens } from '@claude-code/provider/authAlias.js'
import { getOAuthHeaders } from '@claude-code/teleport/api.js'

// ant _A6 = 1e4 (10 seconds) — share API calls bail at 10s rather than
// the SDK default 30s; the model gets a clean failure rather than a
// hung tool call.
const TIMEOUT_MS = 10_000

export type OnboardingGuide = {
  short_code: string
  share_url: string
  updated_at: string
  name?: string
}

async function getAuthAndOrg(): Promise<{
  orgUuid: string
  headers: Record<string, string>
}> {
  const tokens = getClaudeAIOAuthTokens()
  if (!tokens?.accessToken) {
    throw new Error('ShareOnboardingGuide requires Anthropic OAuth login')
  }
  const orgUuid = tokens.tokenAccount?.organizationUuid
  if (!orgUuid) {
    throw new Error('No organization UUID available — login required')
  }
  return {
    orgUuid,
    headers: {
      ...getOAuthHeaders(tokens.accessToken),
      'anthropic-beta': OAUTH_BETA_HEADER,
    },
  }
}

function getBaseUrl(): string {
  return getOauthConfig().BASE_API_URL
}

/** List all guides for the org. ant bL8. */
export async function listOnboardingGuides(): Promise<OnboardingGuide[]> {
  const { orgUuid, headers } = await getAuthAndOrg()
  const url = `${getBaseUrl()}/api/organizations/${orgUuid}/claude_code/onboarding`
  const res = await axios.get<OnboardingGuide[]>(url, {
    headers,
    timeout: TIMEOUT_MS,
  })
  return res.data ?? []
}

/** Create a brand new guide. ant mg7 / dp7. */
export async function createOnboardingGuide(
  content: string,
  name?: string,
): Promise<OnboardingGuide> {
  const { orgUuid, headers } = await getAuthAndOrg()
  const url = `${getBaseUrl()}/api/organizations/${orgUuid}/claude_code/onboarding`
  const res = await axios.post<OnboardingGuide>(
    url,
    { content, name },
    { headers, timeout: TIMEOUT_MS },
  )
  logEvent('tengu_team_onboarding_share_created', {})
  return res.data
}

/** PUT to an existing short_code. ant IL8 / zG8. */
export async function updateOnboardingGuide(
  shortCode: string,
  content: string,
): Promise<OnboardingGuide> {
  const { orgUuid, headers } = await getAuthAndOrg()
  const url = `${getBaseUrl()}/api/organizations/${orgUuid}/claude_code/onboarding/${encodeURIComponent(shortCode)}`
  const res = await axios.put<OnboardingGuide>(
    url,
    { content },
    { headers, timeout: TIMEOUT_MS },
  )
  logEvent('tengu_team_onboarding_share_updated', {})
  return res.data
}

/** Delete a guide. ant pg7 / cp7. */
export async function deleteOnboardingGuide(shortCode: string): Promise<void> {
  const { orgUuid, headers } = await getAuthAndOrg()
  const url = `${getBaseUrl()}/api/organizations/${orgUuid}/claude_code/onboarding/${encodeURIComponent(shortCode)}`
  await axios.delete(url, { headers, timeout: TIMEOUT_MS })
  logEvent('tengu_team_onboarding_share_deleted', {})
}

/** Most recently updated guide for the org (or undefined). ant mL8. */
export async function getMostRecentOnboardingGuide(): Promise<
  OnboardingGuide | undefined
> {
  const list = await listOnboardingGuides()
  if (list.length === 0) return undefined
  return list.reduce((best, cur) =>
    best.updated_at > cur.updated_at ? best : cur,
  )
}
