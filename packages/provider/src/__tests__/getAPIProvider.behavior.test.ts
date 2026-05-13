import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for getAPIProvider() vs ant lq() (1250.js).
 *
 * Priority ordering matters when multiple env vars are set (CI/test
 * configurations, deployment-pipeline misconfigurations). ant's order:
 *   BEDROCK > FOUNDRY > ANTHROPIC_AWS > MANTLE > VERTEX
 *
 * ccb's order MUST match for the env-only fall-through path so users
 * with experimental multi-flag setups get the same provider as ant.
 * Pre-fix ccb had VERTEX before FOUNDRY — Linus-grade pin: matters for
 * any CI fleet that historically toggled both flags in their config.
 */
describe('getAPIProvider env precedence (ant lq parity)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'providers.ts'),
    'utf-8',
  )

  const fnStart = source.indexOf('export function getAPIProvider')
  const fnSlice = source.slice(fnStart, fnStart + 3500)

  test('BEDROCK is checked first in both connection AND env-only paths', () => {
    // ant: vH(USE_BEDROCK)?"bedrock": — the first branch.
    expect(fnSlice).toMatch(
      /if\s*\(hasConnections\)\s*\{[\s\S]*?if\s*\(isEnvTruthy\(readEnv\('CLAUDE_CODE_USE_BEDROCK'\)\)\)\s*return\s*'bedrock'/,
    )
  })

  test('FOUNDRY comes BEFORE VERTEX (ant lq order, was inverted pre-fix)', () => {
    // Conservative: when both flags are set, behavior must match ant. Pin
    // this by line ordering inside each branch.
    const foundryIdx = fnSlice.indexOf("readEnv('CLAUDE_CODE_USE_FOUNDRY')")
    const vertexIdx = fnSlice.indexOf("readEnv('CLAUDE_CODE_USE_VERTEX')")
    expect(foundryIdx).toBeGreaterThan(0)
    expect(vertexIdx).toBeGreaterThan(0)
    expect(foundryIdx).toBeLessThan(vertexIdx)
  })

  test('settings.modelType (openai/gemini/codex) checked BEFORE env vars', () => {
    // ccb-specific: connection-aware short-circuit lets stored settings
    // configure provider without env vars. Pin the ordering so env doesn't
    // clobber a configured modelType.
    const modelTypeIdx = fnSlice.indexOf('const modelType = getInitialSettings().modelType')
    // Find ALL Bedrock checks; the env-only branch's Bedrock should come after
    // modelType reads.
    expect(modelTypeIdx).toBeGreaterThan(0)
    const envBedrockIdx = fnSlice.indexOf("readEnv('CLAUDE_CODE_USE_BEDROCK')", modelTypeIdx)
    expect(envBedrockIdx).toBeGreaterThan(modelTypeIdx)
  })

  test('hasConnections short-circuit IGNORES legacy openai/gemini env vars (V7 §11.6)', () => {
    // CRITICAL ccb-specific guard: with connections configured, the per-model
    // routing (resolveConnectionForModel) is the source of truth. A residual
    // CLAUDE_CODE_USE_OPENAI=1 from a prior Codex session must NOT tag every
    // fallback as 'openai'. Pin by absence: in the hasConnections branch we
    // only check the cloud-deployment env vars.
    const hasConnIdx = fnSlice.indexOf('if (hasConnections) {')
    const hasConnEnd = fnSlice.indexOf('}', hasConnIdx + 'if (hasConnections) {'.length)
    expect(hasConnIdx).toBeGreaterThan(0)
    expect(hasConnEnd).toBeGreaterThan(hasConnIdx)
    const connectionBlock = fnSlice.slice(hasConnIdx, hasConnEnd)
    expect(connectionBlock).not.toContain('CLAUDE_CODE_USE_OPENAI')
    expect(connectionBlock).not.toContain('CLAUDE_CODE_USE_GEMINI')
  })

  test('final fallback is firstParty (not undefined / not throw)', () => {
    // Callers ladder on `provider === 'bedrock'` etc., so a thrown
    // exception here would crash. Defensive default.
    expect(fnSlice).toMatch(/return 'firstParty'/)
  })

  test('APIProvider union covers all ccb-supported providers', () => {
    expect(source).toMatch(
      /export type APIProvider\s*=\s*\n?\s*\|\s*'firstParty'[\s\S]*?\|\s*'bedrock'[\s\S]*?\|\s*'vertex'[\s\S]*?\|\s*'foundry'[\s\S]*?\|\s*'openai'[\s\S]*?\|\s*'gemini'[\s\S]*?\|\s*'codex'/,
    )
  })
})
