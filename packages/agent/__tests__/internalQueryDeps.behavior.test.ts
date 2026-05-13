import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pins for `internal/queryDeps.ts` — the dependency-injection
 * surface used by query.ts to call out to the model + compaction.
 *
 * Critical invariants:
 *  1. callModel is the REAL `queryModelWithStreaming` (NOT routed through a
 *     binding) — direct import keeps the streaming hot path zero-overhead.
 *  2. microcompact: optional-chained host binding. If host returns nothing,
 *     fall back to `{ messages }` (pass-through, NOT a crash). The original
 *     messages array stays intact.
 *  3. autocompact: optional-chained host binding. If host returns nothing,
 *     return `{ wasCompacted: false }` — the loop continues, no compaction
 *     happened, no fake "we just compacted" lie.
 *  4. uuid is the crypto `randomUUID` — NOT a counter or a deterministic
 *     stub. A regression that swaps in a counter would collide across
 *     parallel queries.
 *  5. rapidRefillBreakerTripped is part of the autocompact return type. The
 *     query loop checks this to exit with reason 'rapid_refill_breaker'
 *     instead of looping into more compaction.
 */
describe('internal/queryDeps', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'internal', 'queryDeps.ts'),
    'utf-8',
  )

  describe('production wiring', () => {
    test('callModel is the REAL queryModelWithStreaming (no host indirection)', () => {
      // Pin: direct module import. A future refactor that routes callModel
      // through host bindings would add a function-call layer to the
      // streaming hot path.
      expect(source).toMatch(
        /import \{ queryModelWithStreaming \} from '@claude-code\/provider\/claudeLegacy'/,
      )
      expect(source).toMatch(/callModel: queryModelWithStreaming/)
    })

    test('uuid is crypto randomUUID (NOT a counter or stub)', () => {
      // Pin: collision across parallel queries breaks message dedup.
      expect(source).toMatch(/import \{ randomUUID \} from 'crypto'/)
      expect(source).toMatch(/uuid: randomUUID/)
    })
  })

  describe('microcompact fallback', () => {
    test('host binding called via optional chain', () => {
      expect(source).toMatch(
        /microcompact: async [\s\S]{0,200}?getAgentHostBindings\(\)\.microcompactMessages\?\.\(/,
      )
    })

    test('fallback is `{ messages }` (pass-through, NOT empty)', () => {
      // Pin: if microcompact host binding is absent, return the input
      // messages unchanged. A regression to `{ messages: [] }` would
      // silently drop history.
      expect(source).toMatch(
        /microcompactMessages\?\.\([\s\S]{0,200}?\)\)\s*\?\?\s*\{ messages \}/,
      )
    })

    test('arity: 3 args passed through (messages, ctx, source)', () => {
      expect(source).toMatch(
        /microcompactMessages\?\.\(\s*\n?\s*messages,\s*\n?\s*toolUseContext,\s*\n?\s*querySource,\s*\n?\s*\)/,
      )
    })
  })

  describe('autocompact fallback', () => {
    test('host binding called via optional chain', () => {
      expect(source).toMatch(
        /autocompact: async [\s\S]{0,400}?getAgentHostBindings\(\)\.autoCompactIfNeeded\?\.\(/,
      )
    })

    test('fallback is `{ wasCompacted: false }` (NOT true, NOT a lie)', () => {
      // Pin: missing host MUST report no compaction happened. A regression
      // to `{ wasCompacted: true }` would make the query loop skip its
      // continuation logic.
      expect(source).toMatch(
        /autoCompactIfNeeded\?\.\([\s\S]+?\)\)\s*\?\?\s*\{ wasCompacted: false \}/,
      )
    })

    test('passes all 6 args (msgs, ctx, cacheSafe, source, tracking, snipTokensFreed)', () => {
      expect(source).toMatch(
        /autoCompactIfNeeded\?\.\(\s*\n?\s*messages,\s*\n?\s*toolUseContext,\s*\n?\s*cacheSafeParams,\s*\n?\s*querySource,\s*\n?\s*tracking,\s*\n?\s*snipTokensFreed,/,
      )
    })

    test('return type declares rapidRefillBreakerTripped (V8 reason: rapid_refill_breaker)', () => {
      // Pin: ant 3970.js — autocompact bails out when the breaker trips;
      // caller exits the query loop with reason "rapid_refill_breaker"
      // instead of looping into more compaction.
      expect(source).toMatch(/rapidRefillBreakerTripped\?:\s*boolean/)
    })

    test('return type declares consecutiveRapidRefills (companion counter)', () => {
      expect(source).toMatch(/consecutiveRapidRefills\?:\s*number/)
    })

    test('return type declares consecutiveFailures (also tracked)', () => {
      expect(source).toMatch(/consecutiveFailures\?:\s*number/)
    })
  })

  test('QueryDeps type EXPORTED for downstream typing', () => {
    expect(source).toMatch(/^export type QueryDeps = \{/m)
  })

  test('productionDeps EXPORTED (consumed by query.ts)', () => {
    expect(source).toMatch(/^export function productionDeps\(\): QueryDeps/m)
  })
})
