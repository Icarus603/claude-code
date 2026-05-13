/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handler intentionally exits */

import { createInterface } from 'node:readline/promises'
import {
  clearAuthRelatedCaches,
  performLogout,
} from '@claude-code/provider/commands/logout/logout.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import { getSSLErrorHint } from '@claude-code/provider/errorUtils.js'
import { fetchAndStoreClaudeCodeFirstTokenDate } from '@claude-code/provider/firstTokenDate.js'
import {
  createAndStoreApiKey,
  fetchAndStoreUserRoles,
  refreshOAuthToken,
  shouldUseClaudeAIAuth,
  storeOAuthAccountInfo,
} from '@claude-code/provider/oauth/client.js'
import { getOauthProfileFromOauthToken } from '@claude-code/provider/oauth/getOauthProfile.js'
import { OAuthService } from '@claude-code/provider/oauth/index.js'
import type { OAuthTokens } from '@claude-code/provider/oauth/types.js'
import { LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS } from '@claude-code/provider/oauthConstants.js'
import {
  clearOAuthTokenCache,
  getAnthropicApiKeyWithSource,
  getAuthTokenSource,
  getOauthAccountInfo,
  getSubscriptionType,
  isUsing3PServices,
  saveOAuthTokensIfNeeded,
  validateForceLoginOrg,
} from '@claude-code/provider/authAlias.js'
import { saveGlobalConfig } from '@claude-code/config'
import {
  CLAUDE_AI_CONNECTION_ID,
  getDefaultModelsForProtocol,
  saveConnection,
} from '@claude-code/provider/connections.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { isRunningOnHomespace } from '@claude-code/config/env/utils'
import { errorMessage } from '@claude-code/local-observability/errorHelpers.js'
import { logError } from '@claude-code/local-observability/logging'
import { getAPIProvider } from '@claude-code/provider/providers.js'
import { getInitialSettings } from '@claude-code/config/settings'
import { jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import {
  buildAccountProperties,
  buildAPIProviderProperties,
} from '@claude-code/agent/statusAlias.js'

/**
 * Shared post-token-acquisition logic. Saves tokens, fetches profile/roles,
 * and sets up the local auth state.
 */
function completeHeadlessClaudeAccountLogin(): void {
  saveConnection({
    id: CLAUDE_AI_CONNECTION_ID,
    name: 'Claude Account',
    protocol: 'anthropic',
    endpoint: 'https://api.anthropic.com',
    auth: { type: 'oauth', source: 'claude-ai' },
    enabled: true,
    models: getDefaultModelsForProtocol('anthropic'),
    createdAt: Date.now(),
  })

  saveGlobalConfig(current => ({
    ...current,
    hasCompletedOnboarding: true,
    lastOnboardingVersion: MACRO.VERSION,
  }))
}

async function readManualAuthCode(): Promise<string | null> {
  if (!process.stdin.isTTY) return null

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const value = await rl.question(
      'Paste code here if prompted (AUTHORIZATION_CODE#STATE): ',
    )
    return value.trim() || null
  } finally {
    rl.close()
  }
}

export async function installOAuthTokens(tokens: OAuthTokens): Promise<void> {
  // Clear old state before saving new credentials.
  //
  // Port of ant NZH (3508.js) which calls
  //   `Xw_({ clearOnboarding: false, preserveInProcessTokens: true })`.
  // The preserve flag matters because installOAuthTokens may be called during
  // a refresh-token re-login while CLAUDE_CODE_OAUTH_TOKEN env var (or the
  // FD-loaded token) is still the live source — wiping them mid-flow would
  // race against the new tokens being written.
  await performLogout({ clearOnboarding: false, preserveInProcessTokens: true })

  // Reuse pre-fetched profile if available, otherwise fetch fresh
  const profile =
    tokens.profile ?? (await getOauthProfileFromOauthToken(tokens.accessToken))
  if (profile) {
    storeOAuthAccountInfo({
      accountUuid: profile.account.uuid,
      emailAddress: profile.account.email,
      organizationUuid: profile.organization.uuid,
      displayName: profile.account.display_name || undefined,
      hasExtraUsageEnabled:
        profile.organization?.has_extra_usage_enabled ?? undefined,
      billingType: profile.organization?.billing_type ?? undefined,
      subscriptionCreatedAt:
        profile.organization?.subscription_created_at ?? undefined,
      accountCreatedAt: profile.account.created_at,
      // ant ng6 / ZIH (1255.js): full profile field set including seat tier
      // and trial fields. Without these, /login users start with stale
      // oauthAccount missing the trial countdown / enterprise PAYG flag,
      // and the next routine token refresh's haveProfileAlready guard
      // skips the profile re-fetch (cumulative miss).
      ccOnboardingFlags: profile.organization?.cc_onboarding_flags ?? {},
      claudeCodeTrialEndsAt:
        profile.organization?.claude_code_trial_ends_at ?? null,
      claudeCodeTrialDurationDays:
        profile.organization?.claude_code_trial_duration_days ?? null,
      seatTier: profile.organization?.seat_tier ?? null,
    })
  } else if (tokens.tokenAccount) {
    // Fallback to token exchange account data when profile endpoint fails
    storeOAuthAccountInfo({
      accountUuid: tokens.tokenAccount.uuid,
      emailAddress: tokens.tokenAccount.emailAddress,
      organizationUuid: tokens.tokenAccount.organizationUuid,
    })
  }

  const storageResult = saveOAuthTokensIfNeeded(tokens)
  clearOAuthTokenCache()

  // Port of ant NZH (3508.js) env-var + FD-token coordination:
  //   if (process.env.CLAUDE_CODE_OAUTH_TOKEN)
  //     if (q.success) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  //     else process.env.CLAUDE_CODE_OAUTH_TOKEN = H.accessToken
  //   if (BsH()) A_H(q.success ? null : H.accessToken)
  //
  // Once secure storage holds the token, the env var becomes redundant
  // and we delete it so subsequent reads use the canonical disk source.
  // If storage failed, we ROLL FORWARD the env var to the new access
  // token so the current process keeps working (the next refresh will
  // retry storage).
  // tokens is typed as `unknown` (OAuthTokens stub); local cast keeps the
  // type errors confined to one site instead of a dozen access lines.
  const tokensView = tokens as { accessToken: string }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    if (storageResult.success) {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    } else {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = tokensView.accessToken
    }
  }
  // Same logic for FD-loaded token: only update if a prior FD token exists.
  // BsH() returns the cached value; A_H(null|token) replaces it.
  const { getOauthTokenFromFd, setOauthTokenFromFd } = await import(
    '@claude-code/app-host/bootstrap/state.js'
  )
  if (getOauthTokenFromFd()) {
    setOauthTokenFromFd(storageResult.success ? null : tokensView.accessToken)
  }

  if (storageResult.warning) {
    logEvent('tengu_oauth_storage_warning', {
      warning:
        storageResult.warning as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // Roles and first-token-date may fail for limited-scope tokens (e.g.
  // inference-only from setup-token). They're not required for core auth.
  await fetchAndStoreUserRoles(tokens.accessToken).catch(err =>
    logForDebugging(String(err), { level: 'error' }),
  )

  if (shouldUseClaudeAIAuth(tokens.scopes)) {
    await fetchAndStoreClaudeCodeFirstTokenDate().catch(err =>
      logForDebugging(String(err), { level: 'error' }),
    )
  } else {
    // API key creation is critical for Console users — let it throw.
    const apiKey = await createAndStoreApiKey(tokens.accessToken)
    if (!apiKey) {
      throw new Error(
        'Unable to create API key. The server accepted the request but did not return a key.',
      )
    }
  }

  await clearAuthRelatedCaches()
}

export async function authLogin({
  email,
  sso,
  console: useConsole,
  claudeai,
}: {
  email?: string
  sso?: boolean
  console?: boolean
  claudeai?: boolean
}): Promise<void> {
  if (useConsole && claudeai) {
    process.stderr.write(
      'Error: --console and --claudeai cannot be used together.\n',
    )
    process.exit(1)
  }

  const settings = getInitialSettings()
  // forceLoginMethod is a hard constraint (enterprise setting) — matches ConsoleOAuthFlow behavior.
  // Without it, --console selects Console; --claudeai (or no flag) selects claude.ai.
  const loginWithClaudeAi = settings.forceLoginMethod
    ? settings.forceLoginMethod === 'claudeai'
    : !useConsole
  // Multi-org: OAuth URL takes one UUID; pick first when array.
  const orgUUIDRaw = settings.forceLoginOrgUUID
  const orgUUID = Array.isArray(orgUUIDRaw) ? orgUUIDRaw[0] : orgUUIDRaw

  // Fast path: if a refresh token is provided via env var, skip the browser
  // OAuth flow and exchange it directly for tokens.
  const envRefreshToken = process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN
  if (envRefreshToken) {
    const envScopes = process.env.CLAUDE_CODE_OAUTH_SCOPES
    if (!envScopes) {
      process.stderr.write(
        'CLAUDE_CODE_OAUTH_SCOPES is required when using CLAUDE_CODE_OAUTH_REFRESH_TOKEN.\n' +
          'Set it to the space-separated scopes the refresh token was issued with\n' +
          '(e.g. "user:inference" or "user:profile user:inference user:sessions:claude_code user:mcp_servers").\n',
      )
      process.exit(1)
    }

    const scopes = envScopes.split(/\s+/).filter(Boolean)

    try {
      logEvent('tengu_login_from_refresh_token', {})

      // Port of ant v2.1.136 (3508.js): the headless refresh-token login
      // requests a LONG-LIVED token (1 year via LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS)
      // and propagates CLAUDE_CODE_OAUTH_CLIENT_ID through to the refresh
      // request body so the token stays bound to the env-overridden client.
      const tokens = await refreshOAuthToken(envRefreshToken, {
        scopes,
        expiresIn: LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS,
        clientId: process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || undefined,
      })
      await installOAuthTokens(tokens)

      const orgResult = await validateForceLoginOrg()
      if (!orgResult.valid) {
        process.stderr.write((orgResult as { valid: false; message: string }).message + '\n')
        process.exit(1)
      }

      // Interactive paths handle this via the Onboarding component, but the
      // headless env-var path skips it.
      completeHeadlessClaudeAccountLogin()

      logEvent('tengu_oauth_success', {
        loginWithClaudeAi: shouldUseClaudeAIAuth(tokens.scopes),
      })
      process.stdout.write('Login successful.\n')
      process.exit(0)
    } catch (err) {
      logError(err)
      const sslHint = getSSLErrorHint(err)
      process.stderr.write(
        `Login failed: ${errorMessage(err)}\n${sslHint ? sslHint + '\n' : ''}`,
      )
      process.exit(1)
    }
  }

  const resolvedLoginMethod = sso ? 'sso' : undefined

  const oauthService = new OAuthService()

  try {
    logEvent('tengu_oauth_flow_start', { loginWithClaudeAi })

    const result = await oauthService.startOAuthFlow(
      async url => {
        process.stdout.write('Opening browser to sign in…\n')
        process.stdout.write(`If the browser didn't open, visit: ${url}\n`)
        void readManualAuthCode().then(manualCode => {
          if (!manualCode) return

          const [authorizationCode, state] = manualCode.split('#')
          if (!authorizationCode || !state) {
            process.stderr.write(
              'Invalid code. Paste the full code in AUTHORIZATION_CODE#STATE format.\n',
            )
            return
          }

          oauthService.handleManualAuthCodeInput({
            authorizationCode,
            state,
          })
        })
      },
      {
        loginWithClaudeAi,
        loginHint: email,
        loginMethod: resolvedLoginMethod,
        orgUUID,
      },
    )

    await installOAuthTokens(result)
    completeHeadlessClaudeAccountLogin()

    const orgResult = await validateForceLoginOrg()
    if (!orgResult.valid) {
      process.stderr.write((orgResult as { valid: false; message: string }).message + '\n')
      process.exit(1)
    }

    logEvent('tengu_oauth_success', { loginWithClaudeAi })

    process.stdout.write('Login successful.\n')
    process.exit(0)
  } catch (err) {
    logError(err)
    const sslHint = getSSLErrorHint(err)
    process.stderr.write(
      `Login failed: ${errorMessage(err)}\n${sslHint ? sslHint + '\n' : ''}`,
    )
    process.exit(1)
  } finally {
    oauthService.cleanup()
  }
}

export async function authStatus(opts: {
  json?: boolean
  text?: boolean
}): Promise<void> {
  const { source: authTokenSource, hasToken } = getAuthTokenSource()
  const { source: apiKeySource } = getAnthropicApiKeyWithSource()
  const hasApiKeyEnvVar =
    !!process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()
  const oauthAccount = getOauthAccountInfo()
  const subscriptionType = getSubscriptionType()
  const using3P = isUsing3PServices()
  const loggedIn =
    hasToken || apiKeySource !== 'none' || hasApiKeyEnvVar || using3P

  // Determine auth method
  let authMethod: string = 'none'
  if (using3P) {
    authMethod = 'third_party'
  } else if (authTokenSource === 'claude.ai') {
    authMethod = 'claude.ai'
  } else if (authTokenSource === 'apiKeyHelper') {
    authMethod = 'api_key_helper'
  } else if (authTokenSource !== 'none') {
    authMethod = 'oauth_token'
  } else if (apiKeySource === 'ANTHROPIC_API_KEY' || hasApiKeyEnvVar) {
    authMethod = 'api_key'
  } else if (apiKeySource === '/login managed key') {
    authMethod = 'claude.ai'
  }

  if (opts.text) {
    const properties = [
      ...buildAccountProperties(),
      ...buildAPIProviderProperties(),
    ]
    let hasAuthProperty = false
    for (const prop of properties) {
      const value =
        typeof prop.value === 'string'
          ? prop.value
          : Array.isArray(prop.value)
            ? prop.value.join(', ')
            : null
      if (value === null || value === 'none') {
        continue
      }
      hasAuthProperty = true
      if (prop.label) {
        process.stdout.write(`${prop.label}: ${value}\n`)
      } else {
        process.stdout.write(`${value}\n`)
      }
    }
    if (!hasAuthProperty && hasApiKeyEnvVar) {
      process.stdout.write('API key: ANTHROPIC_API_KEY\n')
    }
    if (!loggedIn) {
      process.stdout.write(
        'Not logged in. Run claude auth login to authenticate.\n',
      )
    }
  } else {
    const apiProvider = getAPIProvider()
    const resolvedApiKeySource =
      apiKeySource !== 'none'
        ? apiKeySource
        : hasApiKeyEnvVar
          ? 'ANTHROPIC_API_KEY'
          : null
    const output: Record<string, string | boolean | null> = {
      loggedIn,
      authMethod,
      apiProvider,
    }
    if (resolvedApiKeySource) {
      output.apiKeySource = resolvedApiKeySource
    }
    if (authMethod === 'claude.ai') {
      output.email = oauthAccount?.emailAddress ?? null
      output.orgId = oauthAccount?.organizationUuid ?? null
      output.orgName = oauthAccount?.organizationName ?? null
      output.subscriptionType = subscriptionType ?? null
    }

    process.stdout.write(jsonStringify(output, null, 2) + '\n')
  }
  process.exit(loggedIn ? 0 : 1)
}

export async function authLogout(): Promise<void> {
  try {
    await performLogout({ clearOnboarding: false })
  } catch {
    process.stderr.write('Failed to log out.\n')
    process.exit(1)
  }
  process.stdout.write('Successfully logged out from your Anthropic account.\n')
  process.exit(0)
}
