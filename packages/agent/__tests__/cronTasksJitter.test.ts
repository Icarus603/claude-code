/**
 * Tests for cron task scheduling helpers — the deterministic-jitter
 * logic that prevents thundering-herd inference spikes when many
 * sessions schedule `0 * * * *` simultaneously.
 *
 * Wrong jitter math = either zero spread (fleet-wide :00 spike returns)
 * or runaway delay (recurring task fires hours late).
 */
import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CRON_JITTER_CONFIG,
  findMissedTasks,
  jitteredNextCronRunMs,
  nextCronRunMs,
  oneShotJitteredNextCronRunMs,
} from '../internal/cronTasksCore.js'

describe('nextCronRunMs', () => {
  test('hourly cron returns next :00 mark strictly after now', () => {
    // 2026-04-30 14:30:00 UTC → next 0 * * * * = 2026-04-30 15:00 UTC
    const t = Date.UTC(2026, 3, 30, 14, 30, 0)
    const next = nextCronRunMs('0 * * * *', t)
    expect(next).not.toBeNull()
    expect(next!).toBeGreaterThan(t)
    // Should be within next 60 minutes
    expect(next! - t).toBeLessThanOrEqual(60 * 60 * 1000)
  })

  test('invalid cron returns null', () => {
    expect(nextCronRunMs('not a cron', Date.now())).toBeNull()
  })

  test('every-minute cron returns next minute', () => {
    const t = Date.UTC(2026, 3, 30, 14, 30, 30) // :30s into a minute
    const next = nextCronRunMs('* * * * *', t)
    expect(next).not.toBeNull()
    // Next minute fires within 60s
    expect(next! - t).toBeLessThanOrEqual(60 * 1000)
  })

  test('strict "after" semantics: cron at exact fromMs does NOT match', () => {
    // 0 * * * * at exactly :00 → next match is :00 of NEXT hour.
    const exact = Date.UTC(2026, 3, 30, 14, 0, 0)
    const next = nextCronRunMs('0 * * * *', exact)
    expect(next!).toBeGreaterThan(exact)
  })
})

describe('jitteredNextCronRunMs — deterministic recurring jitter', () => {
  test('same taskId + same fromMs → same fire time (deterministic)', () => {
    const t = Date.now()
    const a = jitteredNextCronRunMs('0 * * * *', t, 'abcdef01')
    const b = jitteredNextCronRunMs('0 * * * *', t, 'abcdef01')
    expect(a).toBe(b)
  })

  test('different taskId + same fromMs → potentially different fire times', () => {
    const t = Date.UTC(2026, 3, 30, 14, 30, 0)
    const a = jitteredNextCronRunMs('0 * * * *', t, '00000000') // hashes near 0
    const b = jitteredNextCronRunMs('0 * * * *', t, 'ffffffff') // hashes near 1
    expect(a).not.toBe(b)
  })

  test('jitter is FORWARD only (delay, not lead)', () => {
    const t = Date.UTC(2026, 3, 30, 14, 30, 0)
    const baseline = nextCronRunMs('0 * * * *', t)!
    const jittered = jitteredNextCronRunMs('0 * * * *', t, 'ffffffff')!
    expect(jittered).toBeGreaterThanOrEqual(baseline)
  })

  test('jitter respects recurringCapMs cap', () => {
    // Daily cron: gap between fires is 24h. recurringFrac=0.1 → 2.4h
    // would be a huge jitter, but capMs=15min should cap it.
    const t = Date.UTC(2026, 3, 30, 14, 30, 0)
    const baseline = nextCronRunMs('0 0 * * *', t)!
    const jittered = jitteredNextCronRunMs('0 0 * * *', t, 'ffffffff')!
    const offset = jittered - baseline
    expect(offset).toBeLessThanOrEqual(DEFAULT_CRON_JITTER_CONFIG.recurringCapMs)
  })

  test('non-hex taskId falls back to 0 jitter', () => {
    // Per docstring: "Non-hex ids (hand-edited JSON) fall back to 0 = no jitter"
    const t = Date.UTC(2026, 3, 30, 14, 30, 0)
    const baseline = nextCronRunMs('0 * * * *', t)!
    const jittered = jitteredNextCronRunMs('0 * * * *', t, 'not-a-hex-id')!
    // Jitter should be 0 (or very close — frac × cap, frac=0).
    expect(jittered).toBe(baseline)
  })

  test('invalid cron returns null', () => {
    expect(jitteredNextCronRunMs('bad', Date.now(), 'abc')).toBeNull()
  })
})

describe('oneShotJitteredNextCronRunMs — backward jitter (lead)', () => {
  test('non-rounded minute → no jitter (return baseline)', () => {
    // 0 17 * * * fires at :17 → minute % 30 !== 0 → no jitter.
    const t = Date.UTC(2026, 3, 30, 14, 30, 0)
    const baseline = nextCronRunMs('17 * * * *', t)
    const jittered = oneShotJitteredNextCronRunMs('17 * * * *', t, 'abc')
    expect(jittered).toBe(baseline)
  })

  test('jitter clamped to fromMs (does not fire before creation)', () => {
    // Schedule a task that fires within its own jitter window.
    // The Math.max(t1 - lead, fromMs) guarantees it fires no earlier
    // than fromMs.
    const t = Date.now()
    const cron = '0 * * * *' // top of hour
    const result = oneShotJitteredNextCronRunMs(cron, t, 'ffffffff')
    if (result !== null) {
      expect(result).toBeGreaterThanOrEqual(t)
    }
  })

  test('deterministic: same taskId + same fromMs → same fire time', () => {
    const t = Date.UTC(2026, 3, 30, 14, 30, 0)
    const a = oneShotJitteredNextCronRunMs('0 * * * *', t, 'abcdef01')
    const b = oneShotJitteredNextCronRunMs('0 * * * *', t, 'abcdef01')
    expect(a).toBe(b)
  })
})

describe('findMissedTasks', () => {
  test('empty list returns empty', () => {
    expect(findMissedTasks([], Date.now())).toEqual([])
  })

  test('task whose next-from-creation is in the past is missed', () => {
    // Task created 1 day ago with hourly schedule. nextCronRunMs from
    // createdAt = createdAt + 1h. nowMs is 24h later → missed.
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    const tasks = [
      {
        id: 'task1',
        cron: '0 * * * *',
        createdAt: oneDayAgo,
      } as never,
    ]
    expect(findMissedTasks(tasks, Date.now())).toHaveLength(1)
  })

  test('task scheduled in the future is NOT missed', () => {
    // Created 1ms ago, hourly → next fire is in the future.
    const tasks = [
      {
        id: 'task1',
        cron: '0 * * * *',
        createdAt: Date.now() - 1,
      } as never,
    ]
    expect(findMissedTasks(tasks, Date.now())).toEqual([])
  })

  test('task with invalid cron is excluded', () => {
    // nextCronRunMs returns null → filter excludes.
    const tasks = [
      {
        id: 'task1',
        cron: 'invalid',
        createdAt: Date.now() - 100_000_000,
      } as never,
    ]
    expect(findMissedTasks(tasks, Date.now())).toEqual([])
  })

  test('mixed list: only tasks with past next-fire are returned', () => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    const tasks = [
      { id: 'past', cron: '0 * * * *', createdAt: oneDayAgo },
      { id: 'future', cron: '0 * * * *', createdAt: Date.now() - 1 },
      { id: 'invalid', cron: 'bad', createdAt: oneDayAgo },
    ] as never[]
    const missed = findMissedTasks(tasks, Date.now())
    expect(missed).toHaveLength(1)
    expect((missed[0] as { id: string }).id).toBe('past')
  })
})
