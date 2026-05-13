// OAuth client for handling authentication flows with Claude services
import axios from 'axios'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import {
  ALL_OAUTH_SCOPES,
  CLAUDE_AI_INFERENCE_SCOPE,
  CLAUDE_AI_OAUTH_SCOPES,
  getOauthConfig,
} from '../oauthConstants.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  hasProfileScope,
  isClaudeAISubscriber,
  saveApiKey,
} from '../authAlias.js'
import type { AccountInfo } from '@claude-code/config'
import { getGlobalConfig, saveGlobalConfig } from '@claude-code/config'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { getOauthProfileFromOauthToken } from './getOauthProfile.js'
import type {
  BillingType,
  OAuthProfileResponse,
  OAuthTokenExchangeResponse,
  OAuthTokens,
  RateLimitTier,
  SubscriptionType,
  UserRolesResponse,
} from './types.js'
import { readEnv } from '@claude-code/config/env'
import {
  markRefreshTokenDead,
} from './refreshTokenDeadSet.js'

/**
 * Regex for valid OAuth error type names — port of ant v2.1.136
 * `d_1` (1256.js). Matches the canonical RFC 6749 error-type shape:
 * a lowercase letter followed by up to 39 lowercase-underscore chars.
 * Used to filter free-form server payloads before logging the type.
 */
const OAUTH_ERROR_TYPE_PATTERN = /^[a-z][a-z_]{0,39}$/

/**
 * Duck-typed axios error detection — axios sets `isAxiosError: true` on
 * every error its interceptors emit. We don't use `axios.isAxiosError`
 * because some test fixtures install partial axios mocks (memory:
 * "bun mock.module is GLOBAL across the test run") that drop the
 * method without preserving `isAxiosError`. The property check is
 * robust to those mocks.
 */
function isAxiosErrorDuckTyped(
  error: unknown,
): error is { isAxiosError: true; response?: { status: number; data: unknown } } {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error as { isAxiosError?: unknown }).isAxiosError === true,
  )
}

/**
 * Detect an `invalid_grant` response — port of ant v2.1.136 `tu_`
 * (1255.js). Walks the axios error shape three layers deep:
 *   1. The error must come from axios (so we know there is a `.response`).
 *   2. HTTP status must be 400 OR 401 — anything else is a network /
 *      gateway / unexpected error and shouldn't mark the token dead.
 *   3. The body's `error` field must equal `'invalid_grant'`. RFC 6749
 *      lets the body's `error` be either a bare string OR an object
 *      with a `type` field; both are inspected.
 *
 * Public — callers (refreshOAuthToken's catch, telemetry sweepers) use
 * this to decide whether to mark the token dead.
 */
export function isInvalidGrantError(error: unknown): boolean {
  if (!isAxiosErrorDuckTyped(error) || !error.response) return false
  const status = error.response.status
  if (status !== 400 && status !== 401) return false
  const data = error.response.data
  if (!data || typeof data !== 'object') return false
  const err = (data as { error?: unknown }).error
  const type =
    typeof err === 'string'
      ? err
      : err && typeof err === 'object'
        ? (err as { type?: unknown }).type
        : undefined
  return type === 'invalid_grant'
}

/**
 * Extract `oauth_error_status` and `oauth_error_type` analytics fields
 * from an axios error — port of ant v2.1.136 `MBq` (1255.js). The
 * `oauth_error_type` is sanitized through the OAUTH_ERROR_TYPE_PATTERN
 * regex so we only ship server-controlled values that look like real
 * error-type names. Unparseable / non-conforming payloads ship
 * `oauth_error_type:'unparseable'`.
 */
export function extractOAuthErrorFields(
  error: unknown,
): { oauth_error_status?: string; oauth_error_type?: string } {
  if (!isAxiosErrorDuckTyped(error) || !error.response) return {}
  const status = error.response.status
  const data = error.response.data
  let type: string = 'unparseable'
  if (data && typeof data === 'object') {
    const err = (data as { error?: unknown }).error
    const rawType =
      typeof err === 'string'
        ? err
        : err && typeof err === 'object'
          ? (err as { type?: unknown }).type
          : undefined
    if (typeof rawType === 'string' && OAUTH_ERROR_TYPE_PATTERN.test(rawType)) {
      type = rawType
    }
  }
  return {
    oauth_error_status: String(status),
    oauth_error_type: type,
  }
}

/**
 * Check if the user has Claude.ai authentication scope
 * @private Only call this if you're OAuth / auth related code!
 */
export function shouldUseClaudeAIAuth(scopes: string[] | undefined): boolean {
  return Boolean(scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE))
}

export function parseScopes(scopeString?: string): string[] {
  return scopeString?.split(' ').filter(Boolean) ?? []
}

export function buildAuthUrl({
  codeChallenge,
  state,
  port,
  isManual,
  loginWithClaudeAi,
  inferenceOnly,
  orgUUID,
  loginHint,
  loginMethod,
}: {
  codeChallenge: string
  state: string
  port: number
  isManual: boolean
  loginWithClaudeAi?: boolean
  inferenceOnly?: boolean
  orgUUID?: string
  loginHint?: string
  loginMethod?: string
}): string {
  const authUrlBase = loginWithClaudeAi
    ? getOauthConfig().CLAUDE_AI_AUTHORIZE_URL
    : getOauthConfig().CONSOLE_AUTHORIZE_URL

  const authUrl = new URL(authUrlBase)
  authUrl.searchParams.append('code', 'true') // this tells the login page to show Claude Max upsell
  authUrl.searchParams.append('client_id', getOauthConfig().CLIENT_ID)
  authUrl.searchParams.append('response_type', 'code')
  authUrl.searchParams.append(
    'redirect_uri',
    isManual
      ? getOauthConfig().MANUAL_REDIRECT_URL
      : `http://localhost:${port}/callback`,
  )
  const scopesToUse = inferenceOnly
    ? [CLAUDE_AI_INFERENCE_SCOPE] // Long-lived inference-only tokens
    : ALL_OAUTH_SCOPES
  authUrl.searchParams.append('scope', scopesToUse.join(' '))
  authUrl.searchParams.append('code_challenge', codeChallenge)
  authUrl.searchParams.append('code_challenge_method', 'S256')
  authUrl.searchParams.append('state', state)

  // Add orgUUID as URL param if provided
  if (orgUUID) {
    authUrl.searchParams.append('orgUUID', orgUUID)
  }

  // Pre-populate email on the login form (standard OIDC parameter)
  if (loginHint) {
    authUrl.searchParams.append('login_hint', loginHint)
  }

  // Request a specific login method (e.g. 'sso', 'magic_link', 'google')
  if (loginMethod) {
    authUrl.searchParams.append('login_method', loginMethod)
  }

  return authUrl.toString()
}

export async function exchangeCodeForTokens(
  authorizationCode: string,
  state: string,
  codeVerifier: string,
  port: number,
  useManualRedirect: boolean = false,
  expiresIn?: number,
): Promise<OAuthTokenExchangeResponse> {
  const requestBody: Record<string, string | number> = {
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: useManualRedirect
      ? getOauthConfig().MANUAL_REDIRECT_URL
      : `http://localhost:${port}/callback`,
    client_id: getOauthConfig().CLIENT_ID,
    code_verifier: codeVerifier,
    state,
  }

  if (expiresIn !== undefined) {
    requestBody.expires_in = expiresIn
  }

  // Ant `dg6` (1255.js) uses `timeout: 30000`. ccb 15000 is too tight —
  // OAuth token exchange goes through several backend services and can
  // exceed 15s under load (especially during /login surges around
  // release-day). Match ant exactly.
  const response = await axios.post(getOauthConfig().TOKEN_URL, requestBody, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  })

  if (response.status !== 200) {
    throw new Error(
      response.status === 401
        ? 'Authentication failed: Invalid authorization code'
        : `Token exchange failed (${response.status}): ${response.statusText}`,
    )
  }
  logEvent('tengu_oauth_token_exchange_success', {})
  return response.data
}

export async function refreshOAuthToken(
  refreshToken: string,
  { scopes: requestedScopes }: { scopes?: string[] } = {},
): Promise<OAuthTokens> {
  // Note: the dead-set check (`isRefreshTokenDead`) lives in the caller
  // — ant `pt6` (1997.js) — alongside the lockfile + mtime-revalidation
  // dance. refreshOAuthToken itself is the low-level RPC; it doesn't
  // know about the higher-level coordination, just like ant `Bq_`.
  const requestBody = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: getOauthConfig().CLIENT_ID,
    // Request specific scopes, defaulting to the full Claude AI set. The
    // backend's refresh-token grant allows scope expansion beyond what the
    // initial authorize granted (see ALLOWED_SCOPE_EXPANSIONS), so this is
    // safe even for tokens issued before scopes were added to the app's
    // registered oauth_scope.
    scope: (requestedScopes?.length
      ? requestedScopes
      : CLAUDE_AI_OAUTH_SCOPES
    ).join(' '),
  }

  try {
    // Ant `Bq_` (1255.js) uses `timeout: 30000`. Same rationale as
    // exchangeCodeForTokens — token refresh round-trips through the
    // OAuth backend + profile fetch dependencies; 15s is too tight.
    const response = await axios.post(getOauthConfig().TOKEN_URL, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    })

    if (response.status !== 200) {
      throw new Error(`Token refresh failed: ${response.statusText}`)
    }

    const data = response.data as OAuthTokenExchangeResponse
    const {
      access_token: accessToken,
      refresh_token: newRefreshToken = refreshToken,
      expires_in: expiresIn,
    } = data

    const expiresAt = Date.now() + expiresIn * 1000
    const scopes = parseScopes(data.scope)

    logEvent('tengu_oauth_token_refresh_success', {})

    // Skip the extra /api/oauth/profile round-trip when we already have both
    // the global-config profile fields AND the secure-storage subscription data.
    // Routine refreshes satisfy both, so we cut ~7M req/day fleet-wide.
    //
    // Checking secure storage (not just config) matters for the
    // CLAUDE_CODE_OAUTH_REFRESH_TOKEN re-login path: installOAuthTokens runs
    // performLogout() AFTER we return, wiping secure storage. If we returned
    // null for subscriptionType here, saveOAuthTokensIfNeeded would persist
    // null ?? (wiped) ?? null = null, and every future refresh would see the
    // config guard fields satisfied and skip again, permanently losing the
    // subscription type for paying users. By passing through existing values,
    // the re-login path writes cached ?? wiped ?? null = cached; and if secure
    // storage was already empty we fall through to the fetch.
    const config = getGlobalConfig()
    const existing = getClaudeAIOAuthTokens()
    const haveProfileAlready =
      config.oauthAccount?.billingType !== undefined &&
      config.oauthAccount?.accountCreatedAt !== undefined &&
      config.oauthAccount?.subscriptionCreatedAt !== undefined &&
      config.oauthAccount?.ccOnboardingFlags !== undefined &&
      existing?.subscriptionType != null &&
      existing?.rateLimitTier != null

    const profileInfo = haveProfileAlready
      ? null
      : await fetchProfileInfo(accessToken)

    // Update the stored properties if they have changed
    if (profileInfo && config.oauthAccount) {
      const updates: Partial<AccountInfo> = {}
      if (profileInfo.displayName !== undefined) {
        updates.displayName = profileInfo.displayName
      }
      if (typeof profileInfo.hasExtraUsageEnabled === 'boolean') {
        updates.hasExtraUsageEnabled = profileInfo.hasExtraUsageEnabled
      }
      if (profileInfo.billingType !== null) {
        updates.billingType = profileInfo.billingType
      }
      if (profileInfo.accountCreatedAt !== undefined) {
        updates.accountCreatedAt = profileInfo.accountCreatedAt
      }
      if (profileInfo.subscriptionCreatedAt !== undefined) {
        updates.subscriptionCreatedAt = profileInfo.subscriptionCreatedAt
      }
      // ant Bq_: only stamp the trial/seat fields when we actually fetched a
      // rawProfile this turn (haveProfileAlready short-circuit produced no
      // profile, so we must not clobber the stored seatTier with null).
      if (profileInfo.rawProfile) {
        updates.ccOnboardingFlags = profileInfo.ccOnboardingFlags
        updates.claudeCodeTrialEndsAt = profileInfo.claudeCodeTrialEndsAt
        updates.claudeCodeTrialDurationDays =
          profileInfo.claudeCodeTrialDurationDays
        updates.seatTier = profileInfo.seatTier
      }
      if (Object.keys(updates).length > 0) {
        saveGlobalConfig(current => ({
          ...current,
          oauthAccount: current.oauthAccount
            ? { ...current.oauthAccount, ...updates }
            : current.oauthAccount,
        }))
      }
    }

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt,
      scopes,
      subscriptionType:
        profileInfo?.subscriptionType ?? existing?.subscriptionType ?? null,
      rateLimitTier:
        profileInfo?.rateLimitTier ?? existing?.rateLimitTier ?? null,
      profile: profileInfo?.rawProfile,
      tokenAccount: data.account
        ? {
            uuid: data.account.uuid,
            emailAddress: data.account.email_address,
            organizationUuid: data.organization?.uuid,
          }
        : undefined,
    }
  } catch (error) {
    // Port of ant v2.1.136 `Bq_` catch (1255.js):
    //   1. Emit `tengu_oauth_token_refresh_failure` with the error
    //      message AND the structured oauth_error_status /
    //      oauth_error_type fields (via `extractOAuthErrorFields`,
    //      sanitized through the OAUTH_ERROR_TYPE_PATTERN regex).
    //   2. Fire the right outcome event:
    //        - `oauth_refresh_invalid_grant` (xH) — invalid_grant per `tu_`
    //        - `oauth_refresh_request_failed` (G6) — everything else
    //   3. The dead-set marking happens HERE because we have axios-level
    //      response visibility; the higher-level `pt6` loop only sees
    //      the throw and uses `tu_()` to mirror our decision.
    logEvent('tengu_oauth_token_refresh_failure', {
      error: (error as Error)
        .message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...extractOAuthErrorFields(error),
    })
    if (isInvalidGrantError(error)) {
      markRefreshTokenDead(refreshToken)
      logEvent('tengu_oauth_refresh_token_marked_dead_invalid_grant', {})
    }
    throw error
  }
}

export async function fetchAndStoreUserRoles(
  accessToken: string,
): Promise<void> {
  const response = await axios.get(getOauthConfig().ROLES_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (response.status !== 200) {
    throw new Error(`Failed to fetch user roles: ${response.statusText}`)
  }
  const data = response.data as UserRolesResponse
  const config = getGlobalConfig()

  if (!config.oauthAccount) {
    throw new Error('OAuth account information not found in config')
  }

  saveGlobalConfig(current => ({
    ...current,
    oauthAccount: current.oauthAccount
      ? {
          ...current.oauthAccount,
          organizationRole: data.organization_role,
          workspaceRole: data.workspace_role,
          organizationName: data.organization_name,
        }
      : current.oauthAccount,
  }))

  logEvent('tengu_oauth_roles_stored', {
    org_role:
      data.organization_role as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

export async function createAndStoreApiKey(
  accessToken: string,
): Promise<string | null> {
  try {
    const response = await axios.post(getOauthConfig().API_KEY_URL, null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    const apiKey = response.data?.raw_key
    if (apiKey) {
      await saveApiKey(apiKey)
      logEvent('tengu_oauth_api_key', {
        status:
          'success' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        statusCode: response.status,
      })
      return apiKey
    }
    return null
  } catch (error) {
    logEvent('tengu_oauth_api_key', {
      status:
        'failure' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error: (error instanceof Error
        ? error.message
        : String(
            error,
          )) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    throw error
  }
}

export function isOAuthTokenExpired(expiresAt: number | null): boolean {
  if (expiresAt === null) {
    return false
  }

  const bufferTime = 5 * 60 * 1000
  const now = Date.now()
  const expiresWithBuffer = now + bufferTime
  return expiresWithBuffer >= expiresAt
}

export async function fetchProfileInfo(accessToken: string): Promise<{
  subscriptionType: SubscriptionType | null
  displayName?: string
  rateLimitTier: RateLimitTier | null
  hasExtraUsageEnabled: boolean | null
  billingType: BillingType | null
  accountCreatedAt?: string
  subscriptionCreatedAt?: string
  seatTier: string | null
  ccOnboardingFlags: Record<string, unknown>
  claudeCodeTrialEndsAt: string | null
  claudeCodeTrialDurationDays: number | null
  rawProfile?: OAuthProfileResponse
}> {
  const profile = await getOauthProfileFromOauthToken(accessToken)
  const orgType = profile?.organization?.organization_type

  // Reuse the logic from fetchSubscriptionType
  let subscriptionType: SubscriptionType | null = null
  switch (orgType) {
    case 'claude_max':
      subscriptionType = 'max'
      break
    case 'claude_pro':
      subscriptionType = 'pro'
      break
    case 'claude_enterprise':
      subscriptionType = 'enterprise'
      break
    case 'claude_team':
      subscriptionType = 'team'
      break
    default:
      // Return null for unknown organization types
      subscriptionType = null
      break
  }

  const result: {
    subscriptionType: SubscriptionType | null
    displayName?: string
    rateLimitTier: RateLimitTier | null
    hasExtraUsageEnabled: boolean | null
    billingType: BillingType | null
    accountCreatedAt?: string
    subscriptionCreatedAt?: string
    seatTier: string | null
    ccOnboardingFlags: Record<string, unknown>
    claudeCodeTrialEndsAt: string | null
    claudeCodeTrialDurationDays: number | null
  } = {
    subscriptionType,
    rateLimitTier: profile?.organization?.rate_limit_tier ?? null,
    hasExtraUsageEnabled:
      profile?.organization?.has_extra_usage_enabled ?? null,
    billingType: profile?.organization?.billing_type ?? null,
    seatTier: profile?.organization?.seat_tier ?? null,
    ccOnboardingFlags: profile?.organization?.cc_onboarding_flags ?? {},
    claudeCodeTrialEndsAt:
      profile?.organization?.claude_code_trial_ends_at ?? null,
    claudeCodeTrialDurationDays:
      profile?.organization?.claude_code_trial_duration_days ?? null,
  }

  if (profile?.account?.display_name) {
    result.displayName = profile.account.display_name
  }

  if (profile?.account?.created_at) {
    result.accountCreatedAt = profile.account.created_at
  }

  if (profile?.organization?.subscription_created_at) {
    result.subscriptionCreatedAt = profile.organization.subscription_created_at
  }

  logEvent('tengu_oauth_profile_fetch_success', {})

  return { ...result, rawProfile: profile }
}

/**
 * Gets the organization UUID from the OAuth access token
 * @returns The organization UUID or null if not authenticated
 */
export async function getOrganizationUUID(): Promise<string | null> {
  // Check global config first to avoid unnecessary API call
  const globalConfig = getGlobalConfig()
  const orgUUID = globalConfig.oauthAccount?.organizationUuid
  if (orgUUID) {
    return orgUUID
  }

  // Fall back to fetching from profile (requires user:profile scope)
  const accessToken = getClaudeAIOAuthTokens()?.accessToken
  if (accessToken === undefined || !hasProfileScope()) {
    return null
  }
  const profile = await getOauthProfileFromOauthToken(accessToken)
  const profileOrgUUID = profile?.organization?.uuid
  if (!profileOrgUUID) {
    return null
  }
  return profileOrgUUID
}

/**
 * Populate the OAuth account info if it has not already been cached in config.
 * @returns Whether or not the oauth account info was populated.
 */
export async function populateOAuthAccountInfoIfNeeded(): Promise<boolean> {
  // Check env vars first (synchronous, no network call needed).
  // SDK callers like Cowork can provide account info directly, which also
  // eliminates the race condition where early telemetry events lack account info.
  // NB: If/when adding additional SDK-relevant functionality requiring _other_ OAuth account properties,
  // please reach out to #proj-cowork so the team can add additional env var fallbacks.
  const envAccountUuid = readEnv('CLAUDE_CODE_ACCOUNT_UUID')
  const envUserEmail = readEnv('CLAUDE_CODE_USER_EMAIL')
  const envOrganizationUuid = readEnv('CLAUDE_CODE_ORGANIZATION_UUID')
  const hasEnvVars = Boolean(
    envAccountUuid && envUserEmail && envOrganizationUuid,
  )
  if (envAccountUuid && envUserEmail && envOrganizationUuid) {
    if (!getGlobalConfig().oauthAccount) {
      storeOAuthAccountInfo({
        accountUuid: envAccountUuid,
        emailAddress: envUserEmail,
        organizationUuid: envOrganizationUuid,
      })
    }
  }

  // Wait for any in-flight token refresh to complete first, since
  // refreshOAuthToken already fetches and stores profile info
  await checkAndRefreshOAuthTokenIfNeeded()

  const config = getGlobalConfig()
  if (
    (config.oauthAccount &&
      config.oauthAccount.billingType !== undefined &&
      config.oauthAccount.accountCreatedAt !== undefined &&
      config.oauthAccount.subscriptionCreatedAt !== undefined) ||
    !isClaudeAISubscriber() ||
    !hasProfileScope()
  ) {
    return false
  }

  const tokens = getClaudeAIOAuthTokens()
  if (tokens?.accessToken) {
    const profile = await getOauthProfileFromOauthToken(tokens.accessToken)
    if (profile) {
      if (hasEnvVars) {
        logForDebugging(
          'OAuth profile fetch succeeded, overriding env var account info',
          { level: 'info' },
        )
      }
      storeOAuthAccountInfo({
        accountUuid: profile.account.uuid,
        emailAddress: profile.account.email,
        organizationUuid: profile.organization.uuid,
        displayName: profile.account.display_name || undefined,
        hasExtraUsageEnabled:
          profile.organization.has_extra_usage_enabled ?? false,
        billingType: profile.organization.billing_type ?? undefined,
        accountCreatedAt: profile.account.created_at,
        subscriptionCreatedAt:
          profile.organization.subscription_created_at ?? undefined,
      })
      return true
    }
  }
  return false
}

export function storeOAuthAccountInfo({
  accountUuid,
  emailAddress,
  organizationUuid,
  displayName,
  hasExtraUsageEnabled,
  billingType,
  accountCreatedAt,
  subscriptionCreatedAt,
}: {
  accountUuid: string
  emailAddress: string
  organizationUuid: string | undefined
  displayName?: string
  hasExtraUsageEnabled?: boolean
  billingType?: BillingType
  accountCreatedAt?: string
  subscriptionCreatedAt?: string
}): void {
  const accountInfo: AccountInfo = {
    accountUuid,
    emailAddress,
    organizationUuid,
    hasExtraUsageEnabled,
    billingType,
    accountCreatedAt,
    subscriptionCreatedAt,
  }
  if (displayName) {
    accountInfo.displayName = displayName
  }
  saveGlobalConfig(current => {
    // For oauthAccount we need to compare content since it's an object
    if (
      current.oauthAccount?.accountUuid === accountInfo.accountUuid &&
      current.oauthAccount?.emailAddress === accountInfo.emailAddress &&
      current.oauthAccount?.organizationUuid === accountInfo.organizationUuid &&
      current.oauthAccount?.displayName === accountInfo.displayName &&
      current.oauthAccount?.hasExtraUsageEnabled ===
        accountInfo.hasExtraUsageEnabled &&
      current.oauthAccount?.billingType === accountInfo.billingType &&
      current.oauthAccount?.accountCreatedAt === accountInfo.accountCreatedAt &&
      current.oauthAccount?.subscriptionCreatedAt ===
        accountInfo.subscriptionCreatedAt
    ) {
      return current
    }
    return { ...current, oauthAccount: accountInfo }
  })
}
