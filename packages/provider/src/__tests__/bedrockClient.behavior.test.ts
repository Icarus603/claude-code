import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for Bedrock client configuration. Bedrock supports
 * three auth modes:
 *   1. AWS_BEARER_TOKEN_BEDROCK (API key style — Bearer header)
 *   2. CLAUDE_CODE_SKIP_BEDROCK_AUTH (proxy/test scenarios)
 *   3. Default: refresh AWS credentials and pass to SDK
 *
 * Plus ANTHROPIC_BEDROCK_SERVICE_TIER for enterprise priority vs
 * standard routing.
 *
 * Pin all three branches + the service-tier header pass-through.
 */
describe('Bedrock client config (ant 1984.js parity)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'anthropic', 'client.ts'),
    'utf-8',
  )

  test('ANTHROPIC_BEDROCK_SERVICE_TIER env var → X-Amzn-Bedrock-Service-Tier header', () => {
    expect(source).toMatch(/readEnv\('ANTHROPIC_BEDROCK_SERVICE_TIER'\)/)
    expect(source).toMatch(/'X-Amzn-Bedrock-Service-Tier':\s*bedrockServiceTier/)
  })

  test('Service tier header NOT set when env var is unset (preserves AWS default)', () => {
    // Pin the `if (bedrockServiceTier)` guard so a refactor doesn't
    // start sending "X-Amzn-Bedrock-Service-Tier: undefined".
    expect(source).toMatch(/if\s*\(bedrockServiceTier\)\s*\{/)
  })

  test('AWS_BEARER_TOKEN_BEDROCK → skipAuth + Authorization Bearer (API key mode)', () => {
    // The SDK gets skipAuth:true (avoid double-signing) AND a manual
    // Bearer header. Pin BOTH together.
    expect(source).toMatch(
      /if\s*\(readEnv\('AWS_BEARER_TOKEN_BEDROCK'\)\)\s*\{[\s\S]*?bedrockArgs\.skipAuth = true[\s\S]*?Authorization:\s*`Bearer \$\{readEnv\('AWS_BEARER_TOKEN_BEDROCK'\)\}`/,
    )
  })

  test('CLAUDE_CODE_SKIP_BEDROCK_AUTH → skipAuth true (proxy/test scenarios)', () => {
    expect(source).toMatch(
      /\.\.\.\(anthropic\.isEnvTruthy\(readEnv\('CLAUDE_CODE_SKIP_BEDROCK_AUTH'\)\) && \{\s*\n?\s*skipAuth: true/,
    )
  })

  test('default branch: refreshAndGetAwsCredentials + populate awsAccessKey/Secret/Session', () => {
    expect(source).toMatch(
      /await anthropic\.refreshAndGetAwsCredentials\(\)[\s\S]*?bedrockArgs\.awsAccessKey = cachedCredentials\.accessKeyId[\s\S]*?bedrockArgs\.awsSecretKey = cachedCredentials\.secretAccessKey[\s\S]*?bedrockArgs\.awsSessionToken = cachedCredentials\.sessionToken/,
    )
  })

  test('AWS region override for small-fast model via ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION', () => {
    expect(source).toMatch(
      /model === anthropic\.getSmallFastModel\(\) &&\s*\n?\s*readEnv\('ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION'\)\s*\n?\s*\?\s*readEnv\('ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION'\)\s*\n?\s*:\s*anthropic\.getAWSRegion\(\)/,
    )
  })

  test('AnthropicBedrock import is LAZY (dynamic import, not top-level)', () => {
    // Pin lazy import: ~MB of Bedrock SDK shouldn't load at startup for
    // users not using Bedrock.
    expect(source).toMatch(
      /await import\('@anthropic-ai\/bedrock-sdk'\)/,
    )
  })
})
