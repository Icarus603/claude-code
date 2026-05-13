import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for Vertex AI client configuration. Critical invariants:
 *
 * 1. Project-ID discovery: google-auth-library has 4-tier discovery
 *    (env vars → credential files → gcloud config → GCE metadata server).
 *    The metadata server check times out at 12s OUTSIDE GCP. ccb avoids
 *    this by setting projectId fallback when user hasn't configured the
 *    others — pin so a refactor doesn't break the timeout-prevention.
 *
 * 2. CLAUDE_CODE_SKIP_VERTEX_AUTH proxy/test path uses MOCK GoogleAuth
 *    (returns empty headers from getRequestHeaders). Pin so the mock
 *    shape stays compatible with real GoogleAuth signature.
 *
 * 3. refreshGcpCredentialsIfNeeded runs BEFORE GoogleAuth construction
 *    (so the cached creds are fresh).
 */
describe('Vertex client config (12s-timeout-prevention)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'anthropic', 'client.ts'),
    'utf-8',
  )

  test('refreshGcpCredentialsIfNeeded runs BEFORE GoogleAuth import (auth fresh first)', () => {
    const fnStart = source.indexOf("if (anthropic.isEnvTruthy(readEnv('CLAUDE_CODE_USE_VERTEX')))")
    const fnSlice = source.slice(fnStart, fnStart + 3500)
    const refreshIdx = fnSlice.indexOf('refreshGcpCredentialsIfNeeded')
    const googleAuthIdx = fnSlice.indexOf("await Promise.all([\n      import('@anthropic-ai/vertex-sdk')")
    // The refresh happens BEFORE GoogleAuth import.
    expect(refreshIdx).toBeGreaterThan(0)
    expect(googleAuthIdx).toBeGreaterThan(refreshIdx)
  })

  test('refreshGcpCredentials skipped when CLAUDE_CODE_SKIP_VERTEX_AUTH is set', () => {
    // Test/proxy scenarios don't need real credentials.
    const fnStart = source.indexOf("if (anthropic.isEnvTruthy(readEnv('CLAUDE_CODE_USE_VERTEX')))")
    const fnSlice = source.slice(fnStart, fnStart + 1000)
    expect(fnSlice).toMatch(
      /if\s*\(!anthropic\.isEnvTruthy\(readEnv\('CLAUDE_CODE_SKIP_VERTEX_AUTH'\)\)\)\s*\{[\s\S]*?refreshGcpCredentialsIfNeeded/,
    )
  })

  test('project-ID env var discovery checks all 4 google-auth-library variants', () => {
    // CRITICAL: must match google-auth-library's own discovery order, or
    // we'll override when the user configured a project elsewhere.
    expect(source).toMatch(/readEnv\('GCLOUD_PROJECT'\)/)
    expect(source).toMatch(/readEnv\('GOOGLE_CLOUD_PROJECT'\)/)
    expect(source).toMatch(/readEnv\('gcloud_project'\)/)
    expect(source).toMatch(/readEnv\('google_cloud_project'\)/)
  })

  test('credential file env var discovery (both cases)', () => {
    expect(source).toMatch(/readEnv\('GOOGLE_APPLICATION_CREDENTIALS'\)/)
    expect(source).toMatch(/readEnv\('google_application_credentials'\)/)
  })

  test('ANTHROPIC_VERTEX_PROJECT_ID used ONLY as last-resort fallback', () => {
    // Pin: the fallback only kicks in when hasProjectEnvVar AND hasKeyFile
    // are BOTH false. A regression that unconditionally sets projectId
    // would override the user's intended configuration.
    expect(source).toMatch(
      /\.\.\.\(hasProjectEnvVar \|\| hasKeyFile[\s\S]*?\?\s*\{\}\s*:\s*\{[\s\S]*?projectId:\s*readEnv\('ANTHROPIC_VERTEX_PROJECT_ID'\)/,
    )
  })

  test('CLAUDE_CODE_SKIP_VERTEX_AUTH uses mock GoogleAuth (empty headers)', () => {
    // Mock returns getClient → getRequestHeaders that returns {}.
    // Pin the shape so a "let's strengthen the mock" refactor that adds
    // missing fields doesn't accidentally change behavior.
    expect(source).toMatch(
      /getClient: \(\) => \(\{\s*\n?\s*getRequestHeaders: \(\) => \(\{\}\)/,
    )
  })

  test('GoogleAuth scope is cloud-platform (full Vertex access)', () => {
    expect(source).toMatch(
      /scopes:\s*\['https:\/\/www\.googleapis\.com\/auth\/cloud-platform'\]/,
    )
  })

  test('Vertex region from getVertexRegionForModel (per-model)', () => {
    // Vertex doesn't have a single region; some models are only in
    // us-east5, others in us-central1, etc. Pin per-model lookup.
    expect(source).toMatch(/region:\s*anthropic\.getVertexRegionForModel\(model\)/)
  })

  test('AnthropicVertex + google-auth-library both imported LAZILY', () => {
    expect(source).toMatch(
      /Promise\.all\(\[\s*\n?\s*import\('@anthropic-ai\/vertex-sdk'\),\s*\n?\s*import\('google-auth-library'\)/,
    )
  })
})
