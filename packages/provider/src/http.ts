/**
 * HTTP utility constants and helpers
 */

import axios from 'axios'
import { readEnv } from '@claude-code/config/env/utils'
import { OAUTH_BETA_HEADER } from './oauthConstants.js'
import {
  getAnthropicApiKey,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
  isClaudeAISubscriber,
} from './authAlias.js'
import { getClaudeCodeUserAgent } from './userAgent.js'
import { getWorkload } from './workloadContext.js'

// WARNING: We rely on `claude-cli` in the user agent for log filtering.
// Please do NOT change this without making sure that logging also gets updated!
export function getUserAgent(): string {
  const agentSdkVersion = readEnv('CLAUDE_AGENT_SDK_VERSION')
    ? `, agent-sdk/${readEnv('CLAUDE_AGENT_SDK_VERSION')}`
    : ''
  const clientApp = readEnv('CLAUDE_AGENT_SDK_CLIENT_APP')
    ? `, client-app/${readEnv('CLAUDE_AGENT_SDK_CLIENT_APP')}`
    : ''
  const workload = getWorkload()
  const workloadSuffix = workload ? `, workload/${workload}` : ''
  return `claude-cli/${MACRO.VERSION} (${process.env.USER_TYPE}, ${readEnv('CLAUDE_CODE_ENTRYPOINT') ?? 'cli'}${agentSdkVersion}${clientApp}${workloadSuffix})`
}

export function getMCPUserAgent(): string {
  const parts: string[] = []
  const entrypoint = readEnv('CLAUDE_CODE_ENTRYPOINT')
  if (entrypoint) parts.push(entrypoint)
  const sdkVersion = readEnv('CLAUDE_AGENT_SDK_VERSION')
  if (sdkVersion) parts.push(`agent-sdk/${sdkVersion}`)
  const clientApp = readEnv('CLAUDE_AGENT_SDK_CLIENT_APP')
  if (clientApp) parts.push(`client-app/${clientApp}`)
  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `claude-code/${MACRO.VERSION}${suffix}`
}

// User-Agent for WebFetch requests to arbitrary sites.
export function getWebFetchUserAgent(): string {
  return `Claude-User (${getClaudeCodeUserAgent()}; +https://support.anthropic.com/)`
}

export type AuthHeaders = {
  headers: Record<string, string>
  error?: string
}

/**
 * Get authentication headers for API requests
 */
export function getAuthHeaders(): AuthHeaders {
  if (isClaudeAISubscriber()) {
    const oauthTokens = getClaudeAIOAuthTokens()
    if (!oauthTokens?.accessToken) {
      return { headers: {}, error: 'No OAuth token available' }
    }
    return {
      headers: {
        Authorization: `Bearer ${oauthTokens.accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
    }
  }
  const apiKey = getAnthropicApiKey()
  if (!apiKey) return { headers: {}, error: 'No API key available' }
  return { headers: { 'x-api-key': apiKey } }
}

/**
 * Wrapper that handles OAuth 401 errors by force-refreshing the token and
 * retrying once.
 */
export async function withOAuth401Retry<T>(
  request: () => Promise<T>,
  opts?: { also403Revoked?: boolean },
): Promise<T> {
  try {
    return await request()
  } catch (err) {
    if (!axios.isAxiosError(err)) throw err
    const status = err.response?.status
    const isAuthError =
      status === 401 ||
      (opts?.also403Revoked &&
        status === 403 &&
        typeof err.response?.data === 'string' &&
        err.response.data.includes('OAuth token has been revoked'))
    if (!isAuthError) throw err
    const failedAccessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!failedAccessToken) throw err
    await handleOAuth401Error(failedAccessToken)
    return await request()
  }
}
