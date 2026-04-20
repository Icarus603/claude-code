/**
 * Preconnect to the Anthropic API to overlap TCP+TLS handshake with startup.
 *
 * The TCP+TLS handshake is ~100-200ms that normally blocks inside the first
 * API call. Kicking a fire-and-forget fetch during init lets the handshake
 * happen in parallel with action-handler work.
 *
 * Bun's fetch shares a keep-alive connection pool globally, so the real API
 * request reuses the warmed connection.
 */

import { isEnvTruthy, readEnv } from '@claude-code/config/env/utils'
import { getOauthConfig } from '@claude-code/provider/oauthConstants'

let fired = false

export function preconnectAnthropicApi(): void {
  if (fired) return
  fired = true

  // Skip if using a cloud provider — different endpoint + auth
  if (
    isEnvTruthy(readEnv('CLAUDE_CODE_USE_BEDROCK')) ||
    isEnvTruthy(readEnv('CLAUDE_CODE_USE_VERTEX')) ||
    isEnvTruthy(readEnv('CLAUDE_CODE_USE_FOUNDRY'))
  ) {
    return
  }
  // Skip if proxy/mTLS/unix — SDK's custom dispatcher won't reuse this pool
  if (
    readEnv('HTTPS_PROXY') ||
    readEnv('https_proxy') ||
    readEnv('HTTP_PROXY') ||
    readEnv('http_proxy') ||
    readEnv('ANTHROPIC_UNIX_SOCKET') ||
    readEnv('CLAUDE_CODE_CLIENT_CERT') ||
    readEnv('CLAUDE_CODE_CLIENT_KEY')
  ) {
    return
  }

  // Use configured base URL (staging, local, or custom gateway).
  const baseUrl =
    readEnv('ANTHROPIC_BASE_URL') || getOauthConfig().BASE_API_URL

  // Fire and forget. HEAD means no response body — the connection is eligible
  // for keep-alive pool reuse immediately after headers arrive. 10s timeout
  // so a slow network doesn't hang the process.
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  void fetch(baseUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {})
}
