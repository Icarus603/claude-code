import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin anthropicAuthProvider.getCredentials. This is the single source of
 * truth for the {apiKey, authToken, authorizationHeader, subscriber}
 * structure that the SDK client construction consumes.
 *
 * Subscriber identity invariant: if `subscriber === true`, apiKey MUST
 * be null and authToken MUST be the access token. The mutual exclusion
 * prevents accidentally signing with BOTH at the same time, which would
 * confuse Anthropic's auth pipeline.
 */
describe('anthropicAuthProvider.getCredentials', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'auth.ts'),
    'utf-8',
  )

  test('refresh() calls checkAndRefreshOAuthTokenIfNeeded', () => {
    expect(source).toMatch(
      /async refresh\(\): Promise<void> \{[\s\S]*?await getProviderHostBindings\(\)\.auth\.checkAndRefreshOAuthTokenIfNeeded\(\)/,
    )
  })

  test('CRITICAL: subscriber=true → apiKey:null AND authToken from OAuth tokens', () => {
    // Mutual exclusion: a subscriber NEVER gets an apiKey, only OAuth.
    expect(source).toMatch(
      /const apiKey = subscriber\s*\n?\s*\?\s*null\s*\n?\s*:\s*context\?\.apiKeyOverride \|\| auth\.getAnthropicApiKey\(\)/,
    )
    expect(source).toMatch(
      /const authToken = subscriber\s*\n?\s*\?\s*auth\.getClaudeAIOAuthTokens\(\)\?\.accessToken \?\? null\s*\n?\s*:\s*null/,
    )
  })

  test('context.apiKeyOverride wins over auth.getAnthropicApiKey() (for non-subscribers)', () => {
    // Pin so a refactor that drops the override doesn't break SDK
    // callers passing an explicit API key.
    expect(source).toMatch(
      /context\?\.apiKeyOverride \|\| auth\.getAnthropicApiKey\(\)/,
    )
  })

  test('authorizationHeader: subscriber → null, non-subscriber → built from context', () => {
    expect(source).toMatch(
      /authorizationHeader:\s*subscriber\s*\n?\s*\?\s*null\s*\n?\s*:\s*await getAnthropicAuthorizationHeader\(context\)/,
    )
  })

  test('ANT staging OAuth → use staging BASE_API_URL', () => {
    // ant-only build flag for testing against staging API endpoint.
    expect(source).toMatch(
      /process\.env\.USER_TYPE === 'ant' &&[\s\S]*?USE_STAGING_OAUTH[\s\S]*?baseURL:\s*auth\.getOauthConfig\(\)\.BASE_API_URL/,
    )
  })

  test('isAvailable: subscriber OR apiKey OR authToken → true', () => {
    expect(source).toMatch(
      /if\s*\(creds\.subscriber \|\| creds\.apiKey \|\| creds\.authToken\)\s*\{[\s\S]*?return\s*\{\s*available:\s*true/,
    )
  })

  test('isAvailable: nothing → reason mentions both API key AND OAuth (helps debugging)', () => {
    // The reason message helps users diagnose "why am I not authenticated?".
    // Pin the exact phrase so it doesn't drift away from the help docs.
    expect(source).toMatch(
      /reason:\s*'No Anthropic API key or Claude\.ai OAuth token is configured\.'/,
    )
  })
})

describe('createEnvAuthProvider (openAI / Gemini env-based)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'auth.ts'),
    'utf-8',
  )

  test('openAIAuthProvider reads OPENAI_API_KEY env', () => {
    expect(source).toMatch(
      /openAIAuthProvider = createEnvAuthProvider\(\s*\n?\s*'openai',\s*\n?\s*\(\) => readEnv\('OPENAI_API_KEY'\)/,
    )
  })

  test('geminiAuthProvider reads GEMINI_API_KEY env', () => {
    expect(source).toMatch(
      /geminiAuthProvider = createEnvAuthProvider\(\s*\n?\s*'gemini',\s*\n?\s*\(\) => readEnv\('GEMINI_API_KEY'\)/,
    )
  })

  test('createEnvAuthProvider: getCredentials returns { apiKey: token ?? null }', () => {
    expect(source).toMatch(
      /async getCredentials\(\): Promise<\{ apiKey: string \| null \}> \{[\s\S]*?return\s*\{\s*apiKey:\s*getToken\(\) \?\? null/,
    )
  })

  test('createEnvAuthProvider: isAvailable reason includes specific env name', () => {
    expect(source).toMatch(/'OPENAI_API_KEY is not configured\.'/)
    expect(source).toMatch(/'GEMINI_API_KEY is not configured\.'/)
  })

  test('createEnvAuthProvider: refresh is a no-op (env vars are static)', () => {
    expect(source).toMatch(/async refresh\(\): Promise<void> \{\}/)
  })
})
