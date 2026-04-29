import { describe, expect, test } from 'bun:test'
import {
  computeNextCronRun,
  cronToHuman,
  parseCronExpression,
} from '../internal/cronCore.js'

describe('parseCronExpression — wildcards', () => {
  test('all wildcards expand to full range', () => {
    const r = parseCronExpression('* * * * *')
    expect(r?.minute).toHaveLength(60)
    expect(r?.hour).toHaveLength(24)
    expect(r?.dayOfMonth).toHaveLength(31)
    expect(r?.month).toHaveLength(12)
    expect(r?.dayOfWeek).toHaveLength(7)
  })

  test('star-slash-N step', () => {
    const r = parseCronExpression('*/15 * * * *')
    expect(r?.minute).toEqual([0, 15, 30, 45])
  })

  test('star-slash-N step (large divisor)', () => {
    const r = parseCronExpression('*/30 * * * *')
    expect(r?.minute).toEqual([0, 30])
  })

  test('star-slash-1 is same as wildcard', () => {
    const r = parseCronExpression('*/1 * * * *')
    expect(r?.minute).toHaveLength(60)
  })
})

describe('parseCronExpression — single values', () => {
  test('single minute', () => {
    expect(parseCronExpression('30 * * * *')?.minute).toEqual([30])
  })
  test('hour 0 (midnight)', () => {
    expect(parseCronExpression('0 0 * * *')?.hour).toEqual([0])
  })
  test('day 31', () => {
    expect(parseCronExpression('0 0 31 * *')?.dayOfMonth).toEqual([31])
  })
  test('dayOfWeek 7 → normalized to 0 (Sunday)', () => {
    // POSIX cron quirk: 7 is an alias for Sunday (0). Critical contract.
    expect(parseCronExpression('0 0 * * 7')?.dayOfWeek).toEqual([0])
  })
})

describe('parseCronExpression — ranges + lists', () => {
  test('range expands inclusive of both endpoints', () => {
    expect(parseCronExpression('0-5 * * * *')?.minute).toEqual([0, 1, 2, 3, 4, 5])
  })

  test('range with step', () => {
    expect(parseCronExpression('0-10/2 * * * *')?.minute).toEqual([
      0, 2, 4, 6, 8, 10,
    ])
  })

  test('comma-list', () => {
    expect(parseCronExpression('5,10,15 * * * *')?.minute).toEqual([5, 10, 15])
  })

  test('list dedupes and sorts', () => {
    expect(parseCronExpression('15,5,10,5 * * * *')?.minute).toEqual([
      5, 10, 15,
    ])
  })

  test('mixed range + single in list', () => {
    expect(parseCronExpression('0,30-32 * * * *')?.minute).toEqual([
      0, 30, 31, 32,
    ])
  })

  test('dayOfWeek range 5-7 → [5, 6, 0] (7 normalized to 0 mid-range)', () => {
    expect(parseCronExpression('0 0 * * 5-7')?.dayOfWeek.sort()).toEqual([
      0, 5, 6,
    ])
  })
})

describe('parseCronExpression — invalid input', () => {
  test('wrong number of fields → null', () => {
    expect(parseCronExpression('* * * *')).toBeNull()
    expect(parseCronExpression('* * * * * *')).toBeNull()
  })

  test('out-of-range minute (60) → null', () => {
    expect(parseCronExpression('60 * * * *')).toBeNull()
  })

  test('out-of-range hour (24) → null', () => {
    expect(parseCronExpression('0 24 * * *')).toBeNull()
  })

  test('out-of-range day (32) → null', () => {
    expect(parseCronExpression('0 0 32 * *')).toBeNull()
  })

  test('out-of-range month (13) → null', () => {
    expect(parseCronExpression('0 0 * 13 *')).toBeNull()
  })

  test('out-of-range dayOfWeek (8) → null', () => {
    expect(parseCronExpression('0 0 * * 8')).toBeNull()
  })

  test('inverted range (10-5) → null', () => {
    expect(parseCronExpression('10-5 * * * *')).toBeNull()
  })

  test('zero step → null', () => {
    expect(parseCronExpression('*/0 * * * *')).toBeNull()
  })

  test('garbage syntax → null', () => {
    expect(parseCronExpression('@daily')).toBeNull()
    expect(parseCronExpression('foo bar baz qux quux')).toBeNull()
  })

  test('empty string → null', () => {
    expect(parseCronExpression('')).toBeNull()
  })

  test('letters in fields → null', () => {
    expect(parseCronExpression('MON * * * *')).toBeNull()
  })
})

describe('parseCronExpression — whitespace tolerance', () => {
  test('multiple spaces between fields', () => {
    const r = parseCronExpression('0    0    *    *    *')
    expect(r?.minute).toEqual([0])
    expect(r?.hour).toEqual([0])
  })
  test('leading/trailing whitespace trimmed', () => {
    const r = parseCronExpression('  0 0 * * *  ')
    expect(r?.minute).toEqual([0])
  })
  test('tabs treated as whitespace', () => {
    const r = parseCronExpression('0\t0\t*\t*\t*')
    expect(r?.minute).toEqual([0])
  })
})

describe('computeNextCronRun', () => {
  test('every-minute cron returns next minute', () => {
    const fields = parseCronExpression('* * * * *')!
    const from = new Date('2026-01-01T12:00:00')
    const next = computeNextCronRun(fields, from)
    expect(next).not.toBeNull()
    expect(next!.getTime()).toBeGreaterThan(from.getTime())
    // Should be within 60 seconds.
    expect(next!.getTime() - from.getTime()).toBeLessThanOrEqual(60_000)
  })

  test('top-of-hour cron at 12:30 → next is 13:00', () => {
    const fields = parseCronExpression('0 * * * *')!
    const from = new Date('2026-01-01T12:30:00')
    const next = computeNextCronRun(fields, from)
    expect(next?.getMinutes()).toBe(0)
    expect(next?.getHours()).toBe(13)
  })

  test('daily 9am cron from 8am → today at 9am', () => {
    const fields = parseCronExpression('0 9 * * *')!
    const from = new Date('2026-01-01T08:00:00')
    const next = computeNextCronRun(fields, from)
    expect(next?.getDate()).toBe(1)
    expect(next?.getHours()).toBe(9)
    expect(next?.getMinutes()).toBe(0)
  })

  test('daily 9am cron from 10am → tomorrow at 9am', () => {
    const fields = parseCronExpression('0 9 * * *')!
    const from = new Date('2026-01-01T10:00:00')
    const next = computeNextCronRun(fields, from)
    expect(next?.getDate()).toBe(2)
    expect(next?.getHours()).toBe(9)
  })

  test('result is strictly AFTER `from` (not equal to it)', () => {
    // Critical: `from` itself doesn't qualify even if it matches the
    // pattern. Otherwise the scheduler would re-fire the same minute.
    const fields = parseCronExpression('30 12 * * *')!
    const from = new Date('2026-01-01T12:30:00')
    const next = computeNextCronRun(fields, from)
    expect(next!.getTime()).toBeGreaterThan(from.getTime())
  })
})

describe('cronToHuman', () => {
  test('returns a non-empty human string for valid cron', () => {
    const result = cronToHuman('0 9 * * *')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  test('returns input unchanged or fallback for invalid cron', () => {
    const result = cronToHuman('invalid cron expression')
    expect(typeof result).toBe('string')
  })
})
