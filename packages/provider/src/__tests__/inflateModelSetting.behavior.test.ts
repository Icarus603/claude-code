import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for the inflateModelSetting 6-rule resolution cascade.
 *
 * This function bridges settings.json (bare wire ids, schema-shared with
 * official Claude Code) and ccb's internal packed `<connId>:<modelId>`
 * form. Critical because:
 *   - Settings round-trip: official CLI writes bare → ccb reads bare → must
 *     pack for routing → ccb writes back bare for settings.json compat.
 *   - First-wins disambiguation must match providers.ts/resolveConnectionForModel
 *     and the model picker's option order (3-way invariant).
 *
 * Bug history: when this resolver missed a rule, the model picker appended
 * a synthetic "Current model" entry below the real one — symptom of a
 * bare→packed lookup miss.
 */
describe('inflateModelSetting 6-rule cascade', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'connections.ts'),
    'utf-8',
  )

  const fnStart = source.indexOf('export function inflateModelSetting')
  const fnSlice = source.slice(fnStart, fnStart + 2500)

  test('null/undefined/empty input → return unchanged (no-op short-circuit)', () => {
    expect(fnSlice).toMatch(
      /if\s*\(value === null \|\| value === undefined \|\| value === ''\)\s*return value/,
    )
  })

  test('no connections configured → return unchanged (legacy/env path)', () => {
    expect(fnSlice).toMatch(
      /if\s*\(enabled\.length === 0\)\s*return value/,
    )
  })

  test('packed-and-enabled (Rule 1): connId present + enabled → return value as-is', () => {
    expect(fnSlice).toMatch(
      /if\s*\(connectionId !== undefined\)\s*\{[\s\S]*?if\s*\(enabled\.some\(c => c\.id === connectionId\)\)\s*return value/,
    )
  })

  test('packed-stale (Rule 2): connId present but NOT enabled → fall through (no return)', () => {
    // Pin the fall-through behavior: stale connId comment makes it explicit
    // that we DON'T return value here. Without the fall-through, deleting
    // a connection would trap users on the orphan packed id with no way
    // to recover except clearing settings.json.
    expect(fnSlice).toMatch(/Stale prefix; fall through to bare search/)
  })

  test('alias passthrough (Rule 5): opus/sonnet/haiku/opusplan + [1m] variants', () => {
    expect(fnSlice).toMatch(/modelId === 'opus' \|\|/)
    expect(fnSlice).toMatch(/modelId === 'sonnet' \|\|/)
    expect(fnSlice).toMatch(/modelId === 'haiku' \|\|/)
    expect(fnSlice).toMatch(/modelId === 'opusplan' \|\|/)
    expect(fnSlice).toMatch(/modelId === 'sonnet\[1m\]' \|\|/)
    expect(fnSlice).toMatch(/modelId === 'opus\[1m\]'/)
  })

  test('Rule 4: [1m]/[2m] context-size suffix stripped before model match', () => {
    // DeepSeek and similar proxies write the suffix in their model id but
    // the API echoes it back without. resolveConnectionForModel already
    // does this normalization — pin the parity here.
    expect(fnSlice).toMatch(
      /stripContextSuffix\s*=\s*\(id: string\)\s*=>\s*\n?\s*id\.trim\(\)\.toLowerCase\(\)\.replace\(\/\\\[\(1\|2\)m\\\]\$\/i,\s*''\)/,
    )
  })

  test('Rule 3: bare match against connection.models[].id → pack via FIRST matching connection', () => {
    // First-wins is the disambiguation rule. Test pins the loop structure
    // (no break/return after a partial match search).
    expect(fnSlice).toMatch(
      /for\s*\(const conn of enabled\)\s*\{[\s\S]*?for\s*\(const m of conn\.models\)\s*\{[\s\S]*?if\s*\(stripContextSuffix\(m\.id\) === target\)\s*\{?\s*\n?\s*return composeModelId\(conn\.id, modelId\)/,
    )
  })

  test('Rule 6: orphan id (no match) → return value unchanged', () => {
    expect(fnSlice).toMatch(/Orphan id[\s\S]*?return value/)
  })

  test('rule order: short-circuits → connections check → packed → alias → bare-match → orphan', () => {
    // The order is load-bearing: alias check comes AFTER the packed-stale
    // fall-through (so packed aliases get unpacked first), but BEFORE the
    // bare-match loop (so aliases never get packed to a connection).
    const aliasIdx = fnSlice.indexOf("modelId === 'opus' ||")
    const stripContextIdx = fnSlice.indexOf('stripContextSuffix = (id')
    const bareLoopIdx = fnSlice.indexOf('for (const conn of enabled)')
    expect(aliasIdx).toBeGreaterThan(0)
    expect(stripContextIdx).toBeGreaterThan(aliasIdx)
    expect(bareLoopIdx).toBeGreaterThan(stripContextIdx)
  })
})
