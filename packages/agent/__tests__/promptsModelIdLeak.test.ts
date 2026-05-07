import { beforeAll, describe, expect, test } from 'bun:test'
import { installConfigHostBindings } from '@claude-code/config'
import { InMemoryConfig } from '@claude-code/config/testing'
import { computeEnvInfo, computeSimpleEnvInfo } from '../prompts.js'

beforeAll(() => {
  // prompts.ts pulls in getInitialSettings() (via getAPIProvider) which
  // requires the config host bindings to be installed before any settings
  // read. Use the in-memory binding so the test is hermetic.
  installConfigHostBindings(new InMemoryConfig().bindings)
})

/**
 * Contract test: the system-prompt env info must never carry the
 * connection-routing prefix (`<connId>:<modelId>`) into a user-visible
 * string. ccb's internal world (AppState, model picker, route resolution)
 * keys on packed ids, but the system prompt is what the LLM sees and
 * what the user reads — it must be the bare wire id.
 *
 * Regression caught:
 *   The user noticed the system prompt said
 *     "The exact model ID is conn_4ohrs652:claude-opus-4-7"
 *   when on a Pro/Max OAuth subscription. Root cause: prompts.ts
 *   interpolated `${modelId}` directly without stripping the prefix —
 *   getMarketingNameForModel() did substring-match on "claude-opus-4-7"
 *   and returned a correct marketing name, which masked the leak in the
 *   adjacent `${modelId}` interpolation.
 *
 * The leak is invisible to most automated checks: build still passes,
 * runtime still works, but the LLM's self-description leaks an internal
 * routing artifact. Lock it with a contract test.
 */
describe('prompts.ts: packed modelId is unpacked before user-facing interpolation', () => {
  const PACKED = 'conn_4ohrs652:claude-opus-4-7'
  const BARE = 'claude-opus-4-7'

  test('computeEnvInfo: no `conn_*:` prefix in output for a packed input', async () => {
    const out = await computeEnvInfo(PACKED)
    expect(out).not.toContain('conn_4ohrs652:')
    expect(out).toContain(BARE)
    // marketing name should still resolve correctly post-unpack
    expect(out).toContain('Opus 4.7')
  })

  test('computeSimpleEnvInfo: no `conn_*:` prefix in output for a packed input', async () => {
    const out = await computeSimpleEnvInfo(PACKED)
    expect(out).not.toContain('conn_4ohrs652:')
    expect(out).toContain(BARE)
    expect(out).toContain('Opus 4.7')
  })

  test('computeEnvInfo: bare input round-trips unchanged', async () => {
    // Sanity — ensure unpack is a no-op on already-bare input.
    const out = await computeEnvInfo(BARE)
    expect(out).toContain(BARE)
    expect(out).not.toContain('conn_')
  })

  test('computeSimpleEnvInfo: bare input round-trips unchanged', async () => {
    const out = await computeSimpleEnvInfo(BARE)
    expect(out).toContain(BARE)
    expect(out).not.toContain('conn_')
  })

  test('computeEnvInfo: knowledge cutoff resolves on packed input (was substring-match-tolerant before, but should not regress)', async () => {
    // Before the fix this happened to work because getCanonicalName uses
    // substring matching, but post-fix we explicitly pass the bare id.
    // This test pins that the cutoff still surfaces.
    const out = await computeEnvInfo(PACKED)
    expect(out).toContain('knowledge cutoff is January 2026')
  })
})
