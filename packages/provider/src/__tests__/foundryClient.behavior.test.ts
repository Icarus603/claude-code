import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for Foundry (Azure) client config.
 *
 * Foundry has two auth modes:
 *   1. ANTHROPIC_FOUNDRY_API_KEY env var → SDK reads it by default
 *      (azureADTokenProvider stays undefined)
 *   2. No API key → use DefaultAzureCredential via @azure/identity
 *
 * CLAUDE_CODE_SKIP_FOUNDRY_AUTH: mock token provider for test/proxy scenarios.
 *
 * Pin all three branches + the Azure scope string.
 */
describe('Foundry client config (Azure AD auth)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'anthropic', 'client.ts'),
    'utf-8',
  )

  test('Foundry branch dispatches on CLAUDE_CODE_USE_FOUNDRY', () => {
    expect(source).toMatch(
      /if\s*\(anthropic\.isEnvTruthy\(readEnv\('CLAUDE_CODE_USE_FOUNDRY'\)\)\)\s*\{[\s\S]*?await import\('@anthropic-ai\/foundry-sdk'\)/,
    )
  })

  test('ANTHROPIC_FOUNDRY_API_KEY → SDK reads it (azureADTokenProvider stays undefined)', () => {
    // The `if (!readEnv('ANTHROPIC_FOUNDRY_API_KEY'))` gate means: when
    // the API key IS set, the provider stays undefined and the SDK
    // handles auth via its default env-var read.
    expect(source).toMatch(/if\s*\(!readEnv\('ANTHROPIC_FOUNDRY_API_KEY'\)\)/)
  })

  test('CLAUDE_CODE_SKIP_FOUNDRY_AUTH → mock token provider (empty string)', () => {
    // Returns `Promise.resolve('')` — pin the empty-string return so
    // a refactor doesn't accidentally use a placeholder like 'mock-token'
    // that downstream auth might log/leak.
    expect(source).toMatch(
      /CLAUDE_CODE_SKIP_FOUNDRY_AUTH[\s\S]*?azureADTokenProvider = \(\) => Promise\.resolve\(''\)/,
    )
  })

  test('default branch uses DefaultAzureCredential via @azure/identity', () => {
    expect(source).toMatch(
      /await import\('@azure\/identity'\)[\s\S]*?getBearerTokenProvider\([\s\S]*?new AzureCredential\(\)/,
    )
  })

  test('Azure scope = cognitiveservices.azure.com/.default (exact URL)', () => {
    // Wrong scope → "insufficient_scope" 403 from Azure. Pin the exact
    // URL — Microsoft uses /.default for "all preconfigured scopes for
    // this resource".
    expect(source).toMatch(
      /'https:\/\/cognitiveservices\.azure\.com\/\.default'/,
    )
  })

  test('AnthropicFoundry + @azure/identity both imported LAZILY', () => {
    expect(source).toMatch(/await import\('@anthropic-ai\/foundry-sdk'\)/)
    expect(source).toMatch(/await import\('@azure\/identity'\)/)
  })

  test('azureADTokenProvider spread conditionally (no key in args if undefined)', () => {
    // Pin so an "always pass azureADTokenProvider" refactor doesn't
    // override the SDK's own ANTHROPIC_FOUNDRY_API_KEY env-var path.
    expect(source).toMatch(
      /\.\.\.\(azureADTokenProvider && \{ azureADTokenProvider \}\)/,
    )
  })
})
