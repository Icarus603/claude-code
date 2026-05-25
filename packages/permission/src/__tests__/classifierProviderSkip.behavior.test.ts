import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for the auto-mode classifier's non-Anthropic provider
 * skip (`classifyYoloAction` guard in yoloClassifier.ts).
 *
 * Why source-level: `classifyYoloAction` makes a live sideQuery and its
 * skip branch is the very first thing it does — there's no exported pure
 * helper to unit-test, and bun:test runs with feature flags OFF
 * (TRANSCRIPT_CLASSIFIER gated), so the classifier path can't run live here.
 * We pin the SHAPE of the guard instead.
 *
 * The guard exists because ccb adds multi-provider connections (openai /
 * gemini / codex) on top of ant's Anthropic-only world. The classifier
 * builds an Anthropic-protocol request (forced `tool_choice`,
 * `stop_sequences`) that those protocols can't honour:
 *   - openai / gemini route to their own SDK adapters (no Anthropic
 *     /v1/messages classifier body).
 *   - codex routes through the codex fetch-adapter which hard-codes
 *     `tool_choice: 'auto'` and drops `stop_sequences` — the forced
 *     `classify_result` call is downgraded so Codex often omits it,
 *     making every action spuriously `shouldBlock:true`.
 *
 * Bug history: the guard originally listed only openai/gemini; codex slipped
 * through and broke auto-mode for ChatGPT-account users (each tool call
 * spuriously blocked). This pin locks all THREE non-Anthropic protocols into
 * the skip so a future edit can't drop one silently.
 */
describe('Auto-mode classifier non-Anthropic provider skip', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'yoloClassifier.ts'),
    'utf-8',
  )

  const fnStart = source.indexOf('export async function classifyYoloAction')
  expect(fnStart).toBeGreaterThan(0)
  // The guard is at the top of the function but preceded by a long
  // explanatory comment; 2600 chars covers comment + guard body.
  const guardSlice = source.slice(fnStart, fnStart + 2600)

  test('skips openai provider', () => {
    expect(guardSlice).toMatch(/provider === 'openai'/)
  })

  test('skips gemini provider', () => {
    expect(guardSlice).toMatch(/provider === 'gemini'/)
  })

  test('skips codex provider (regression: was missing, broke ChatGPT-account auto-mode)', () => {
    expect(guardSlice).toMatch(/provider === 'codex'/)
  })

  test('all three non-Anthropic protocols are in the same skip condition', () => {
    // One combined `if` so the skip is atomic — not three divergent branches
    // that could disagree on the returned shape.
    expect(guardSlice).toMatch(
      /provider === 'openai' \|\| provider === 'gemini' \|\| provider === 'codex'/,
    )
  })

  test('skip returns unavailable:true so the caller applies iron-gate policy', () => {
    // unavailable:true is what routes to the fail-closed/fail-open decision
    // in permissions.ts — NOT a bare shouldBlock:false that would silently
    // allow. Pin both fields together.
    expect(guardSlice).toMatch(/shouldBlock: false/)
    expect(guardSlice).toMatch(/unavailable: true/)
  })

  test('skip reason names the provider', () => {
    expect(guardSlice).toMatch(
      /Auto mode unavailable for \$\{provider\} provider/,
    )
  })
})
