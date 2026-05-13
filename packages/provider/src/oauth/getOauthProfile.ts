import axios from 'axios'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../oauthConstants.js'
import type { OAuthProfileResponse } from './types.js'
import { getAnthropicApiKey } from '../authAlias.js'
import { getGlobalConfig } from '@claude-code/config'
import { logEvent } from '@claude-code/local-observability'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '@claude-code/local-observability'
import { logError } from '@claude-code/local-observability/logging'

export async function getOauthProfileFromApiKey(): Promise<
  OAuthProfileResponse | undefined
> {
  // Assumes interactive session
  const config = getGlobalConfig()
  const accountUuid = config.oauthAccount?.accountUuid
  const apiKey = getAnthropicApiKey()

  // Need both account UUID and API key to check
  if (!accountUuid || !apiKey) {
    return
  }
  const endpoint = `${getOauthConfig().BASE_API_URL}/api/claude_cli_profile`
  try {
    const response = await axios.get<OAuthProfileResponse>(endpoint, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
      params: {
        account_uuid: accountUuid,
      },
      timeout: 10000,
    })
    logEvent('tengu_oauth_profile_fetch_succeeded', { method: 'api_key' })
    // Port of ant 1254.js yH("oauth_profile_fetch") — feature-ok counter.
    logEvent('tengu_feature_ok', {
      feature_name:
        'oauth_profile_fetch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return response.data
  } catch (error) {
    logEvent('tengu_oauth_profile_fetch_failed', { method: 'api_key' })
    // Port of ant 1254.js G6("oauth_profile_fetch", "oauth_profile_api_key_failed").
    logEvent('tengu_feature_sad', {
      feature_name:
        'oauth_profile_fetch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'oauth_profile_api_key_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logError(error as Error)
  }
}

export async function getOauthProfileFromOauthToken(
  accessToken: string,
): Promise<OAuthProfileResponse | undefined> {
  const endpoint = `${getOauthConfig().BASE_API_URL}/api/oauth/profile`
  try {
    const response = await axios.get<OAuthProfileResponse>(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    })
    logEvent('tengu_oauth_profile_fetch_succeeded', { method: 'oauth_token' })
    // Port of ant 1254.js Ur() yH("oauth_profile_fetch") — feature-ok counter.
    logEvent('tengu_feature_ok', {
      feature_name:
        'oauth_profile_fetch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return response.data
  } catch (error) {
    logEvent('tengu_oauth_profile_fetch_failed', { method: 'oauth_token' })
    // Port of ant 1254.js Ur() G6("oauth_profile_fetch", "oauth_profile_token_failed").
    logEvent('tengu_feature_sad', {
      feature_name:
        'oauth_profile_fetch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'oauth_profile_token_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logError(error as Error)
  }
}
