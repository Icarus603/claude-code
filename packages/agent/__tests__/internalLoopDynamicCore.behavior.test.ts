import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  MAX_LOOP_DELAY_SECONDS,
  MIN_LOOP_DELAY_SECONDS,
} from '../internal/loopDynamicCore.js'

/**
 * Source-level pins for `internal/loopDynamicCore.ts` — the algorithm
 * behind ScheduleWakeupTool. Port of ant v2.1.123 (resplit/2551.js, VS1).
 *
 * Core invariants worth pinning byte-for-byte:
 *   1. Delay clamp window: [60, 3600] seconds.
 *   2. NaN → MIN_LOOP_DELAY_SECONDS (60), Infinity → MAX (3600),
 *      -Infinity → MIN (60). These three NaN/Infinity paths are real
 *      ant behavior — a refactor that defaults NaN to 0 would crash the
 *      cron generator.
 *   3. Cron string format: 5-field `${min} ${hour} * * *` (NOT 6-field
 *      with seconds; NOT 7-field with year).
 *   4. Cron tasks tagged with `kind: 'loop'` (distinguishes from /dream
 *      and user crons).
 *   5. Re-scheduling cancels existing loops with same prompt (no dupes).
 *   6. recurringMaxAgeMs cap (default 7 days): refuses with telemetry
 *      `tengu_loop_dynamic_wakeup_aged_out` and returns null.
 *   7. Stale-chain detection: chain considered fresh if silent past
 *      MAX_LOOP_DELAY_SECONDS. Reset startedAt on stale.
 *   8. Cache-lead-time correction: pulls target back 1 minute at a time
 *      while still within 5-min window AND above MIN floor. Keeps wake
 *      from landing on cache-expiry.
 *   9. isLoopDynamicEnabled uses LAZY require (avoids feature-flag
 *      eager-load on package import).
 */
describe('internal/loopDynamicCore — public constants', () => {
  test('MIN_LOOP_DELAY_SECONDS = 60', () => {
    expect(MIN_LOOP_DELAY_SECONDS).toBe(60)
  })

  test('MAX_LOOP_DELAY_SECONDS = 3600 (1 hour ceiling)', () => {
    expect(MAX_LOOP_DELAY_SECONDS).toBe(3600)
  })
})

describe('internal/loopDynamicCore — source pins', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'internal', 'loopDynamicCore.ts'),
    'utf-8',
  )

  describe('Delay clamping (NaN / Infinity handling)', () => {
    test('NaN(delay) → MIN_LOOP_DELAY_SECONDS (60s)', () => {
      // Pin: a regression that defaults NaN to 0 would generate an
      // invalid cron string (Math.round(NaN) → NaN).
      expect(source).toMatch(
        /if \(Number\.isNaN\(delaySeconds\)\) \{\s*\n?\s*raw = MIN_LOOP_DELAY_SECONDS/,
      )
    })

    test('Infinity → MAX_LOOP_DELAY_SECONDS (3600s)', () => {
      expect(source).toMatch(
        /else if \(delaySeconds === Infinity\) \{\s*\n?\s*raw = MAX_LOOP_DELAY_SECONDS/,
      )
    })

    test('-Infinity → MIN_LOOP_DELAY_SECONDS (60s)', () => {
      expect(source).toMatch(
        /else if \(delaySeconds === -Infinity\) \{\s*\n?\s*raw = MIN_LOOP_DELAY_SECONDS/,
      )
    })

    test('finite → Math.round (NOT floor or ceil)', () => {
      // Pin: ant uses Math.round so 60.4 → 60, 60.5 → 61. floor/ceil
      // would systematically bias the schedule by half a second over
      // many calls.
      expect(source).toMatch(/raw = Math\.round\(delaySeconds\)/)
    })

    test('clamp uses Math.max + Math.min nested (NOT a custom clamp helper)', () => {
      expect(source).toMatch(
        /const clamped = Math\.max\(\s*\n?\s*MIN_LOOP_DELAY_SECONDS,\s*\n?\s*Math\.min\(MAX_LOOP_DELAY_SECONDS, raw\),\s*\n?\s*\)/,
      )
    })

    test('wasClamped flag: !isFinite OR raw !== clamped', () => {
      // Pin: non-finite ALWAYS marked clamped. A refactor that drops
      // !isFinite would let Infinity pass with wasClamped=false.
      expect(source).toMatch(
        /wasClamped = !Number\.isFinite\(delaySeconds\) \|\| raw !== clamped/,
      )
    })
  })

  describe('Cron string format', () => {
    test('5-field cron string: `${min} ${hour} * * *`', () => {
      // Pin: 5-field. ant cron parser doesn't take 6 or 7 fields here.
      expect(source).toMatch(
        /const cron = `\$\{target\.getMinutes\(\)\} \$\{target\.getHours\(\)\} \* \* \*`/,
      )
    })

    test('cron tasks tagged with kind: "loop"', () => {
      // Pin: distinguishes loop crons from /dream and user-set crons.
      // Filters on `t.kind === 'loop'` in cancel paths.
      expect(source).toMatch(/kind: 'loop',/)
    })
  })

  describe('Time alignment', () => {
    test('alignToNextMinute bumps to next minute when sec/ms > 0', () => {
      expect(source).toMatch(
        /if \(d\.getSeconds\(\) > 0 \|\| d\.getMilliseconds\(\) > 0\) \{\s*\n?\s*d\.setMinutes\(d\.getMinutes\(\) \+ 1\)\s*\n?\s*\}/,
      )
    })

    test('alignToNextMinute zeroes seconds AND ms via setSeconds(0, 0)', () => {
      // Pin: the (0,0) two-arg form. setSeconds(0) alone leaves ms.
      expect(source).toMatch(/d\.setSeconds\(0, 0\)/)
    })

    test('FIVE_MINUTES_MS = 5 * 60 * 1000 (cache lead window)', () => {
      expect(source).toMatch(/FIVE_MINUTES_MS = 5 \* 60 \* 1000/)
    })

    test('cache-lead correction: pulls back by 60_000 ms (1 minute)', () => {
      expect(source).toMatch(/alignedMs -= 60_000/)
    })

    test('cache-lead loop floor: alignedMs - 60_000 >= now + MIN floor', () => {
      // Pin: never pulls target below the 60-second floor.
      expect(source).toMatch(
        /alignedMs - 60_000 >= now \+ MIN_LOOP_DELAY_SECONDS \* 1000/,
      )
    })
  })

  describe('Chain age cap (recurringMaxAgeMs)', () => {
    test('returns null when age >= recurringMaxAgeMs', () => {
      expect(source).toMatch(
        /now - startedAt >= recurringMaxAgeMs[\s\S]+?return null/,
      )
    })

    test('emits tengu_loop_dynamic_wakeup_aged_out telemetry on cap hit', () => {
      // Pin: this exact event name lives in upstream ant telemetry; a
      // rename would orphan dashboards.
      expect(source).toMatch(/'tengu_loop_dynamic_wakeup_aged_out'/)
    })

    test('aged-out sets agedOut: true ONCE (idempotent)', () => {
      // Pin: guard `if (!existing?.agedOut)` — a regression would fire
      // telemetry every check, polluting dashboards.
      expect(source).toMatch(
        /if \(!existing\?\.agedOut\) \{[\s\S]+?agedOut: true,/,
      )
    })

    test('stale chain (silent past MAX_LOOP_DELAY) resets startedAt', () => {
      expect(source).toMatch(
        /isStaleChain =\s*\n?\s*existing !== undefined &&\s*\n?\s*now > existing\.lastScheduledFor \+ MAX_LOOP_DELAY_SECONDS \* 1000/,
      )
    })
  })

  describe('Prompt deduplication on reschedule', () => {
    test('cancelLoopCronsForPrompt filters by kind="loop" AND prompt match', () => {
      // Pin: matches BOTH fields. Filtering on prompt alone would
      // accidentally drop /dream crons sharing a prompt.
      expect(source).toMatch(
        /\.filter\(t => t\.kind === 'loop' && t\.prompt === prompt\)/,
      )
    })

    test('scheduleLoopWakeup calls cancelLoopCronsForPrompt FIRST', () => {
      // Pin: cancel before re-add. Inverting would briefly have BOTH
      // crons active, double-firing.
      const fnStart = source.indexOf('export function scheduleLoopWakeup')
      const body = source.slice(fnStart, fnStart + 500)
      // First non-signature statement in the body must be the cancel call.
      expect(body).toMatch(
        /\): ScheduleResult \| null \{\s*\n\s*cancelLoopCronsForPrompt\(prompt\)/,
      )
    })
  })

  describe('Cancel-all path', () => {
    test('cancelAllPendingLoopSessionCrons returns count of cancelled crons', () => {
      expect(source).toMatch(
        /export function cancelAllPendingLoopSessionCrons\(\): number/,
      )
      expect(source).toMatch(/return loopCrons\.length/)
    })

    test('cancel-all clears loopChainStartedAt entries (so re-arm is fresh)', () => {
      // Pin: deleteLoopChainStartedAt called per cancelled cron.
      // Forgetting would leave stale `startedAt` clock running, prematurely
      // aging the next re-armed loop.
      expect(source).toMatch(
        /for \(const t of loopCrons\) deleteLoopChainStartedAt\(t\.prompt\)/,
      )
    })

    test('early-return 0 when no loop crons (no telemetry, no work)', () => {
      expect(source).toMatch(
        /if \(loopCrons\.length === 0\) return 0/,
      )
    })
  })

  describe('Telemetry payload', () => {
    test('emits tengu_loop_dynamic_wakeup_scheduled with reason capped at 200 chars', () => {
      // Pin: 200-char cap protects telemetry from oversized prompts.
      expect(source).toMatch(/reason\.slice\(0, 200\)/)
    })

    test('chosen_delay_seconds: 0 when input is non-finite', () => {
      // Pin: telemetry can't serialize Infinity/NaN; ant substitutes 0.
      expect(source).toMatch(
        /chosen_delay_seconds: Number\.isFinite\(delaySeconds\) \? delaySeconds : 0/,
      )
    })
  })

  describe('Feature flag (lazy import)', () => {
    test('isLoopDynamicEnabled uses lazy require (NOT top-level import)', () => {
      // Pin: feature-flags pulls in growthbook + zod. Top-level import
      // would eager-load on every agent package import.
      expect(source).toMatch(
        /isLoopDynamicEnabled[\s\S]+?require\(\s*\n?\s*'@claude-code\/config\/feature-flags',?\s*\n?\s*\)/,
      )
    })

    test('flag name is "tengu_kairos_loop_dynamic" with default false', () => {
      // Pin: ant flag name. Renaming would silently disable feature.
      expect(source).toMatch(
        /getFeatureValue_CACHED_MAY_BE_STALE\(\s*\n?\s*'tengu_kairos_loop_dynamic',\s*\n?\s*false,?\s*\n?\s*\)/,
      )
    })
  })

  describe('Loop short-id generation', () => {
    test('makeLoopShortId is 8-char zero-padded hex from random uint32', () => {
      // Pin: 8 chars matches ant's id format. A rewrite to randomUUID
      // would change the format (with dashes) and break filtering.
      expect(source).toMatch(
        /Math\.floor\(Math\.random\(\) \* 0xffffffff\)\s*\n?\s*\.toString\(16\)\s*\n?\s*\.padStart\(8, '0'\)/,
      )
    })
  })

  describe('Scheduler state side effects', () => {
    test('schedule sets scheduledTasksEnabled = true (so cron loop runs)', () => {
      // Pin: without this, the new cron sits forever. ant flips this
      // each schedule (idempotent state set).
      expect(source).toMatch(/setScheduledTasksEnabled\(true\)/)
    })

    test('setLoopChainStartedAt called with new lastScheduledFor', () => {
      expect(source).toMatch(
        /setLoopChainStartedAt\(prompt, \{ startedAt, lastScheduledFor: targetMs \}\)/,
      )
    })
  })
})
