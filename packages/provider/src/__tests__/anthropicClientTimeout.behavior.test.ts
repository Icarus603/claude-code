import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for the API client timeout, ARGS construction, and
 * provider-specific routing in anthropic/client.ts. These get-it-wrong
 * symptoms:
 * - Wrong default timeout → users with slow networks see "timeout" before
 *   the API actually returned
 * - Lost CLAUDE_CODE_USE_BEDROCK / VERTEX / FOUNDRY branch → users on
 *   those clouds silently get firstParty client (Bearer leaks to wrong
 *   endpoint, then 401 confuses them)
 * - Wrong ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION precedence → background
 *   sessions hit wrong AWS region
 */
describe('anthropic/client.ts timeout + routing (ant bx)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'anthropic', 'client.ts'),
    'utf-8',
  )

  test('default timeout is 600s (matches ant; lets refresh + profile + slow links complete)', () => {
    expect(source).toMatch(
      /timeout:\s*parseInt\(readEnv\('API_TIMEOUT_MS'\)\s*\|\|\s*String\(600\s*\*\s*1000\),\s*10\)/,
    )
  })

  test('dangerouslyAllowBrowser=true (Bun runtime detection is browser-like)', () => {
    // ant: same flag because the SDK's `typeof window === "object"` heuristic
    // triggers under Bun. Without this the SDK refuses to construct a client.
    expect(source).toMatch(/dangerouslyAllowBrowser:\s*true/)
  })

  test('Bedrock branch dispatches on CLAUDE_CODE_USE_BEDROCK env', () => {
    expect(source).toMatch(
      /if\s*\(anthropic\.isEnvTruthy\(readEnv\('CLAUDE_CODE_USE_BEDROCK'\)\)\)/,
    )
    expect(source).toMatch(/await import\('@anthropic-ai\/bedrock-sdk'\)/)
  })

  test('Bedrock small-fast-model region override via ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION', () => {
    // Pin the precedence: small-fast model + override env set → override
    // wins; everything else → default region. Without this, background
    // Haiku calls would hit the same region as Opus traffic, defeating
    // the whole point of the env knob.
    expect(source).toMatch(
      /model === anthropic\.getSmallFastModel\(\) &&\s*\n?\s*readEnv\('ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION'\)/,
    )
  })

  test('proxy/fetch options come from networkLayer.getProxyFetchOptions({forAnthropicAPI:true})', () => {
    // The forAnthropicAPI:true flag enables MTLS + corporate proxy handling
    // that's anthropic-API-specific (different from OpenAI/Gemini proxy).
    expect(source).toMatch(
      /networkLayer\.getProxyFetchOptions\(\{\s*\n?\s*forAnthropicAPI:\s*true,?\s*\n?\s*\}\)/,
    )
  })
})
