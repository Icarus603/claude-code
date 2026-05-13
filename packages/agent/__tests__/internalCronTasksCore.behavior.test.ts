import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_CRON_JITTER_CONFIG,
  findMissedTasks,
  jitteredNextCronRunMs,
  nextCronRunMs,
  oneShotJitteredNextCronRunMs,
} from '../internal/cronTasksCore.js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Pin invariants for cron task scheduling — the algorithm behind ant's
 * scheduled tasks system and KAIROS /dream.
 *
 * The most important pins:
 *  1. DEFAULT_CRON_JITTER_CONFIG numerical defaults — these are the
 *     thundering-herd protection parameters. Changing them affects every
 *     ccb session's load distribution.
 *  2. jitteredNextCronRunMs spreads recurring fires forward (proportional
 *     to gap, capped by recurringCapMs).
 *  3. oneShotJitteredNextCronRunMs spreads one-shots BACKWARD (early fire
 *     is invisible to user; late would break "remind me at 3pm" contract).
 *  4. Jitter ONLY applies to minute marks where minute % oneShotMinuteMod
 *     === 0 (default 30 → only :00 and :30 get spread, because humans
 *     round to half-hours).
 *  5. Clamp: oneShotJittered MUST NOT return a time before `fromMs` (a
 *     task can't fire before it was created).
 */
describe('internal/cronTasksCore', () => {
  describe('DEFAULT_CRON_JITTER_CONFIG numerical defaults', () => {
    test('recurringFrac = 0.1 (10% of gap)', () => {
      // Pin: 10% gap means hourly task spreads across [:00, :06)
      expect(DEFAULT_CRON_JITTER_CONFIG.recurringFrac).toBe(0.1)
    })

    test('recurringCapMs = 15 minutes (15 * 60 * 1000 = 900_000)', () => {
      expect(DEFAULT_CRON_JITTER_CONFIG.recurringCapMs).toBe(15 * 60 * 1000)
    })

    test('oneShotMaxMs = 90 seconds (one-shots fire up to 90s early)', () => {
      expect(DEFAULT_CRON_JITTER_CONFIG.oneShotMaxMs).toBe(90 * 1000)
    })

    test('oneShotFloorMs = 0 (default: hash-near-0 fires on exact mark)', () => {
      // Pin: ops can raise this to guarantee NO task fires on the mark.
      expect(DEFAULT_CRON_JITTER_CONFIG.oneShotFloorMs).toBe(0)
    })

    test('oneShotMinuteMod = 30 (only :00 and :30 get jitter)', () => {
      // Pin: humans round to half-hours, so the herd risk is on :00 / :30.
      expect(DEFAULT_CRON_JITTER_CONFIG.oneShotMinuteMod).toBe(30)
    })

    test('recurringMaxAgeMs = 7 days (auto-expire recurring tasks)', () => {
      // Pin: prevents unbounded session lifetime extension.
      // Permanent flag exempts (assistant mode's built-ins).
      expect(DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs).toBe(
        7 * 24 * 60 * 60 * 1000,
      )
    })

    test('cacheLeadMs = 60_000 (60s pull-back from 5-min cache TTL)', () => {
      // Pin: prompt cache lives 5min; pulling 60s back keeps wakeup
      // inside the warm window.
      expect(DEFAULT_CRON_JITTER_CONFIG.cacheLeadMs).toBe(60_000)
    })
  })

  describe('nextCronRunMs', () => {
    test('invalid cron → null', () => {
      expect(nextCronRunMs('not a cron', Date.now())).toBeNull()
    })

    test('valid daily cron returns a future timestamp', () => {
      const next = nextCronRunMs('30 14 * * *', Date.now())
      expect(next).not.toBeNull()
      expect(next!).toBeGreaterThan(Date.now())
    })

    test('strictly-after semantics: next-from-now is NOT now', () => {
      // Pin: `from` is exclusive lower bound. If we ask "next 14:30" at
      // exactly 14:30, we get tomorrow's 14:30, not today's.
      const today = new Date()
      today.setHours(14, 30, 0, 0)
      const next = nextCronRunMs('30 14 * * *', today.getTime())
      expect(next).toBeGreaterThan(today.getTime())
    })
  })

  describe('jitteredNextCronRunMs (recurring — forward jitter)', () => {
    test('returns null when cron is invalid', () => {
      expect(jitteredNextCronRunMs('garbage', Date.now(), '00000000')).toBeNull()
    })

    test('hash-to-zero taskId fires on exact mark (no jitter)', () => {
      const from = Date.now()
      const exact = nextCronRunMs('0 * * * *', from)
      const jittered = jitteredNextCronRunMs('0 * * * *', from, '00000000')
      // jitterFrac('00000000') = 0 → no forward delay.
      expect(jittered).toBe(exact)
    })

    test('hash-to-max taskId fires within capped forward window', () => {
      const from = Date.now()
      const exact = nextCronRunMs('0 * * * *', from)!
      const jittered = jitteredNextCronRunMs('0 * * * *', from, 'ffffffff')!
      // Pin: max jitter ≤ recurringCapMs AND ≤ recurringFrac * (t2 - t1).
      // For hourly, t2 - t1 = 3_600_000; 10% = 360_000; cap = 900_000 →
      // bound is 360_000.
      expect(jittered - exact).toBeLessThanOrEqual(360_000)
      expect(jittered).toBeGreaterThan(exact)
    })

    test('cap (15min) bounds jitter even when proportional would be larger', () => {
      // Pin: cap dominates when the gap is big enough.
      // For daily cron, 10% * 86400_000 = 8_640_000 > 900_000 cap.
      const from = Date.now()
      const exact = nextCronRunMs('0 14 * * *', from)!
      const jittered = jitteredNextCronRunMs('0 14 * * *', from, 'ffffffff')!
      expect(jittered - exact).toBeLessThanOrEqual(900_000)
    })

    test('same taskId → deterministic jitter (cache-friendly across reloads)', () => {
      const from = 1700_000_000_000 // fixed
      const a = jitteredNextCronRunMs('0 * * * *', from, 'deadbeef')
      const b = jitteredNextCronRunMs('0 * * * *', from, 'deadbeef')
      expect(a).toBe(b)
    })

    test('different taskIds → different jitter (spreads across taskId space)', () => {
      const from = 1700_000_000_000
      const a = jitteredNextCronRunMs('0 * * * *', from, '00000000')
      const b = jitteredNextCronRunMs('0 * * * *', from, 'ffffffff')
      expect(a).not.toBe(b)
    })
  })

  describe('oneShotJitteredNextCronRunMs (one-shot — backward jitter)', () => {
    test('returns null when cron invalid', () => {
      expect(
        oneShotJitteredNextCronRunMs('garbage', Date.now(), 'aaaaaaaa'),
      ).toBeNull()
    })

    test(':30 fire mark gets jitter (humans round to half-hour)', () => {
      // 14:30 is a :30 mark; should fire EARLY when taskId hashes high.
      const from = new Date()
      from.setHours(14, 0, 0, 0)
      const exact = nextCronRunMs('30 14 * * *', from.getTime())!
      const jittered = oneShotJitteredNextCronRunMs(
        '30 14 * * *',
        from.getTime(),
        'ffffffff',
      )!
      // Pin: jittered < exact (backward), within 90s window.
      expect(jittered).toBeLessThan(exact)
      expect(exact - jittered).toBeLessThanOrEqual(90_000)
    })

    test(':17 fire mark gets NO jitter (not on a herd minute)', () => {
      // :17 is not ≡ 0 (mod 30) → falls through, returns exact time.
      const from = new Date()
      from.setHours(14, 0, 0, 0)
      const exact = nextCronRunMs('17 14 * * *', from.getTime())!
      const jittered = oneShotJitteredNextCronRunMs(
        '17 14 * * *',
        from.getTime(),
        'ffffffff',
      )!
      expect(jittered).toBe(exact)
    })

    test('clamp: jittered MUST NOT be earlier than `fromMs`', () => {
      // Pin: task created inside its own jitter window shouldn't fire
      // before creation.
      // Simulate: from = exact - 30s (so 30s before the mark) with high
      // hash trying to pull back 90s → would land 60s before creation.
      const today = new Date()
      today.setHours(14, 30, 0, 0)
      const exactMark = today.getTime()
      const fromMs = exactMark - 30_000 // 30s before
      const jittered = oneShotJitteredNextCronRunMs(
        '30 14 * * *',
        fromMs,
        'ffffffff',
      )!
      expect(jittered).toBeGreaterThanOrEqual(fromMs)
    })

    test('floor > 0 forces minimum lead even for hash-to-zero taskIds', () => {
      // Pin: cfg.oneShotFloorMs controls "minimum early fire". With
      // floor=30_000, EVERY task on a mark gets ≥ 30s of lead.
      const cfg = {
        ...DEFAULT_CRON_JITTER_CONFIG,
        oneShotFloorMs: 30_000,
      }
      const from = new Date()
      from.setHours(14, 0, 0, 0)
      const exact = nextCronRunMs('30 14 * * *', from.getTime())!
      const jittered = oneShotJitteredNextCronRunMs(
        '30 14 * * *',
        from.getTime(),
        '00000000',
        cfg,
      )!
      // 30s lead floor → jittered ≤ exact - 30s
      expect(exact - jittered).toBeGreaterThanOrEqual(30_000)
    })
  })

  describe('findMissedTasks', () => {
    test('task whose next-from-createdAt is in past → missed', () => {
      const tasks = [
        {
          id: 'a',
          cron: '0 14 * * *', // daily 14:00
          prompt: 'p',
          createdAt: Date.now() - 24 * 60 * 60 * 1000 - 60_000, // > 24h ago
        },
      ]
      const missed = findMissedTasks(tasks, Date.now())
      expect(missed.length).toBe(1)
      expect(missed[0]!.id).toBe('a')
    })

    test('task whose next-from-createdAt is in future → NOT missed', () => {
      const tasks = [
        {
          id: 'b',
          cron: '0 14 * * *',
          prompt: 'p',
          createdAt: Date.now(),
        },
      ]
      const missed = findMissedTasks(tasks, Date.now())
      expect(missed).toEqual([])
    })

    test('invalid cron task → NOT missed (and not crash)', () => {
      const tasks = [
        {
          id: 'c',
          cron: 'bogus',
          prompt: 'p',
          createdAt: Date.now() - 10_000,
        },
      ]
      expect(findMissedTasks(tasks, Date.now())).toEqual([])
    })

    test('empty list → empty result', () => {
      expect(findMissedTasks([], Date.now())).toEqual([])
    })
  })

  describe('source-level pins', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'internal', 'cronTasksCore.ts'),
      'utf-8',
    )

    test('CRON_FILE_REL hardcoded to .claude/scheduled_tasks.json', () => {
      // Pin: critical disk path. If this drifts, every running session
      // would lose its tasks on next read.
      expect(source).toMatch(
        /CRON_FILE_REL = join\('\.claude', 'scheduled_tasks\.json'\)/,
      )
    })

    test('addCronTask uses randomUUID().slice(0, 8) (8-char short id)', () => {
      // Pin: short id shared between UI and disk. Tool layer renders
      // these to users; longer form would not fit.
      expect(source).toMatch(/randomUUID\(\)\.slice\(0, 8\)/)
    })

    test('writeCronTasks strips runtime-only `durable` flag', () => {
      // Pin: disk format = { id, cron, prompt, createdAt, ... }. durable
      // = false means session-only and should NEVER reach disk.
      expect(source).toMatch(/\{ durable: _durable, \.\.\.rest \}/)
    })

    test('jitterFrac parses first 8 hex chars / 0x_1_0000_0000', () => {
      // Pin: stable hash; non-hex falls through to 0 (no jitter).
      expect(source).toMatch(
        /parseInt\(taskId\.slice\(0, 8\), 16\) \/ 0x1_0000_0000/,
      )
    })

    test('oneShotJittered checks getMinutes() NOT getUTCMinutes()', () => {
      // Pin: half-hour-offset zones (UTC+5:30 India) — local round time
      // !== UTC round time. Using UTC would jitter the wrong marks.
      expect(source).toMatch(
        /new Date\(t1\)\.getMinutes\(\) % cfg\.oneShotMinuteMod/,
      )
    })

    test('writeCronTasks recursive: true on .claude mkdir', () => {
      // Pin: idempotent dir creation, doesn't crash on second call.
      expect(source).toMatch(
        /mkdir\(join\(root, '\.claude'\), \{ recursive: true \}\)/,
      )
    })

    test('listAllCronTasks ONLY merges session tasks when dir undefined', () => {
      // Pin: daemon callers pass `dir` explicitly; they have no session
      // store. Guard prevents bootstrap-state leakage into daemon path.
      expect(source).toMatch(
        /if \(dir !== undefined\) return fileTasks/,
      )
    })

    test('removeCronTasks short-circuits when ids empty', () => {
      expect(source).toMatch(
        /removeCronTasks[\s\S]+?if \(ids\.length === 0\) return/,
      )
    })

    test('readCronTasks drops invalid cron strings silently (logs debug)', () => {
      // Pin: one bad task can't block the whole file.
      expect(source).toMatch(
        /\[ScheduledTasks\] skipping task \$\{t\.id\} with invalid cron/,
      )
    })

    test('readCronTasks logs debug on malformed task entries (silent drop)', () => {
      expect(source).toMatch(
        /\[ScheduledTasks\] skipping malformed task/,
      )
    })
  })
})
