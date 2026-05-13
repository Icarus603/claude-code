import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for getContextWindowForModel + has1mContext +
 * modelSupports1M (agent/context.ts).
 *
 * 1M context is GA for Opus 4.7 / 4.6 / Sonnet 4.x. Getting these defaults
 * wrong has two severities:
 *   - 200K when it should be 1M: compaction triggers ~5× too early.
 *     Users notice (lots of "compaction" attachments mid-task).
 *   - 1M when model doesn't support it: API rejects with 400 "context
 *     limit exceeded" once the input crosses 200K.
 *
 * CLAUDE_CODE_DISABLE_1M_CONTEXT=1 is the HIPAA-path escape hatch (forces
 * 200K) — must be honored everywhere has1m / modelSupports1M is consulted.
 */
describe('1M-context detection (vs ant model gate)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'context.ts'),
    'utf-8',
  )

  test('CLAUDE_CODE_DISABLE_1M_CONTEXT short-circuits has1mContext to false', () => {
    expect(source).toMatch(
      /export function has1mContext\(model: string\): boolean \{[\s\S]*?if\s*\(is1mContextDisabled\(\)\)\s*\{?\s*\n?\s*return false/,
    )
  })

  test('[1m] suffix marker recognized (legacy Sonnet 4.0 opt-in)', () => {
    expect(source).toMatch(/\/\\\[1m\\\]\/i\.test\(model\)/)
  })

  test('modelSupports1M includes ALL three model families that have 1M GA', () => {
    expect(source).toMatch(/canonical\.includes\('claude-sonnet-4'\)/)
    expect(source).toMatch(/canonical\.includes\('opus-4-7'\)/)
    expect(source).toMatch(/canonical\.includes\('opus-4-6'\)/)
  })

  test('modelSupports1M EXCLUDES Haiku 4.5 (genuinely 200K)', () => {
    // No haiku in the explicit list. Pin by absence.
    const fnStart = source.indexOf('export function modelSupports1M')
    const fnEnd = source.indexOf('\n}', fnStart) + 2
    const fnBody = source.slice(fnStart, fnEnd)
    expect(fnBody).not.toMatch(/haiku/i)
  })

  test('getContextWindowForModel: ant CLAUDE_CODE_MAX_CONTEXT_TOKENS env override comes FIRST', () => {
    // Order matters — if [1m] check ran first, env-override couldn't shrink
    // the window for testing. Pin the order.
    const fnStart = source.indexOf('export function getContextWindowForModel')
    const fnSlice = source.slice(fnStart, fnStart + 2000)
    const envOverrideIdx = fnSlice.indexOf("readEnv('CLAUDE_CODE_MAX_CONTEXT_TOKENS')")
    const has1mIdx = fnSlice.indexOf('has1mContext(model)')
    expect(envOverrideIdx).toBeGreaterThan(0)
    expect(envOverrideIdx).toBeLessThan(has1mIdx)
  })

  test('1M is returned for Opus 4.7 / 4.6 / Sonnet 4.x BEFORE falling to 200K default', () => {
    const fnStart = source.indexOf('export function getContextWindowForModel')
    const fnSlice = source.slice(fnStart, fnStart + 2000)
    expect(fnSlice).toMatch(
      /if\s*\(modelSupports1M\(model\)\)\s*\{?\s*\n?\s*return 1_000_000/,
    )
  })

  test('falls through to MODEL_CONTEXT_WINDOW_DEFAULT (200K) when none apply', () => {
    const fnStart = source.indexOf('export function getContextWindowForModel')
    const fnSlice = source.slice(fnStart, fnStart + 2500)
    expect(fnSlice).toMatch(/return MODEL_CONTEXT_WINDOW_DEFAULT/)
  })
})
