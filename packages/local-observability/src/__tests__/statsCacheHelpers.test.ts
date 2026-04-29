/**
 * Tests for statsCache pure helpers — drive incremental aggregation
 * for the /stats display, /usage charts, and longest-session tracking.
 *
 * Wrong merge math = misleading dashboards (e.g. "you've used 10x your
 * actual tokens" or "longest session was 2s long because the merger
 * compared timestamps not durations").
 *
 * Date helpers underpin streak calculations — wrong "before" comparison
 * means yesterday's session never counts toward the streak.
 */
import { describe, expect, test } from 'bun:test'
import {
  isDateBefore,
  mergeCacheWithNewStats,
  type PersistedStatsCache,
  toDateString,
} from '../aggregates/statsCache.js'

describe('toDateString', () => {
  test('extracts YYYY-MM-DD from a Date', () => {
    const d = new Date('2026-04-30T15:30:00Z')
    expect(toDateString(d)).toBe('2026-04-30')
  })

  test('uses UTC date (not local)', () => {
    // Same instant in UTC and local time may differ by a day.
    // toISOString() always yields UTC.
    const d = new Date('2026-04-30T23:59:59.999Z')
    expect(toDateString(d)).toBe('2026-04-30')
  })

  test('throws on invalid Date (toISOString returns "Invalid Date")', () => {
    const invalid = new Date('not a date')
    expect(() => toDateString(invalid)).toThrow()
  })
})

describe('isDateBefore', () => {
  test('earlier date < later date → true', () => {
    expect(isDateBefore('2026-04-29', '2026-04-30')).toBe(true)
  })

  test('same date → false', () => {
    expect(isDateBefore('2026-04-30', '2026-04-30')).toBe(false)
  })

  test('later date → false', () => {
    expect(isDateBefore('2026-05-01', '2026-04-30')).toBe(false)
  })

  test('lexicographic comparison works on YYYY-MM-DD', () => {
    // YYYY-MM-DD strings sort the same as actual dates.
    expect(isDateBefore('2025-12-31', '2026-01-01')).toBe(true)
    expect(isDateBefore('2026-01-01', '2025-12-31')).toBe(false)
  })

  test('different month boundaries', () => {
    expect(isDateBefore('2026-04-30', '2026-05-01')).toBe(true)
    expect(isDateBefore('2026-04-01', '2026-04-30')).toBe(true)
  })
})

const emptyCache = (): PersistedStatsCache => ({
  version: 3,
  lastComputedDate: null,
  dailyActivity: [],
  dailyModelTokens: [],
  modelUsage: {},
  totalSessions: 0,
  totalMessages: 0,
  longestSession: null,
  firstSessionDate: null,
  hourCounts: {},
  totalSpeculationTimeSavedMs: 0,
})

const emptyNewStats = () => ({
  dailyActivity: [],
  dailyModelTokens: [],
  modelUsage: {},
  sessionStats: [],
  hourCounts: {},
  totalSpeculationTimeSavedMs: 0,
})

const sampleUsage = () => ({
  inputTokens: 100,
  outputTokens: 200,
  cacheReadInputTokens: 50,
  cacheCreationInputTokens: 30,
  webSearchRequests: 0,
  costUSD: 0.01,
  contextWindow: 200_000,
  maxOutputTokens: 8_192,
})

describe('mergeCacheWithNewStats — empty merge', () => {
  test('empty cache + empty new stats → empty cache with updated lastComputedDate', () => {
    const result = mergeCacheWithNewStats(emptyCache(), emptyNewStats(), '2026-04-30')
    expect(result.lastComputedDate).toBe('2026-04-30')
    expect(result.totalSessions).toBe(0)
    expect(result.totalMessages).toBe(0)
    expect(result.longestSession).toBeNull()
  })

  test('lastComputedDate always overwritten (not merged)', () => {
    const cache = { ...emptyCache(), lastComputedDate: '2026-04-29' }
    const result = mergeCacheWithNewStats(cache, emptyNewStats(), '2026-04-30')
    expect(result.lastComputedDate).toBe('2026-04-30')
  })
})

describe('mergeCacheWithNewStats — daily activity merge', () => {
  test('new days appended, output sorted ascending', () => {
    const cache = {
      ...emptyCache(),
      dailyActivity: [
        { date: '2026-04-29', messageCount: 1, sessionCount: 1, toolCallCount: 1 },
      ],
    }
    const result = mergeCacheWithNewStats(
      cache,
      {
        ...emptyNewStats(),
        dailyActivity: [
          { date: '2026-04-30', messageCount: 2, sessionCount: 2, toolCallCount: 2 },
          { date: '2026-04-28', messageCount: 3, sessionCount: 3, toolCallCount: 3 },
        ],
      },
      '2026-04-30',
    )
    expect(result.dailyActivity.map(d => d.date)).toEqual([
      '2026-04-28',
      '2026-04-29',
      '2026-04-30',
    ])
  })

  test('same-date merge: counts SUMMED', () => {
    const cache = {
      ...emptyCache(),
      dailyActivity: [
        { date: '2026-04-30', messageCount: 5, sessionCount: 1, toolCallCount: 2 },
      ],
    }
    const result = mergeCacheWithNewStats(
      cache,
      {
        ...emptyNewStats(),
        dailyActivity: [
          { date: '2026-04-30', messageCount: 3, sessionCount: 1, toolCallCount: 2 },
        ],
      },
      '2026-04-30',
    )
    expect(result.dailyActivity).toHaveLength(1)
    expect(result.dailyActivity[0]).toEqual({
      date: '2026-04-30',
      messageCount: 8,
      sessionCount: 2,
      toolCallCount: 4,
    })
  })
})

describe('mergeCacheWithNewStats — daily model tokens', () => {
  test('new model tokens for new date inserted', () => {
    const result = mergeCacheWithNewStats(
      emptyCache(),
      {
        ...emptyNewStats(),
        dailyModelTokens: [
          { date: '2026-04-30', tokensByModel: { 'claude-opus': 1000 } },
        ],
      },
      '2026-04-30',
    )
    expect(result.dailyModelTokens).toHaveLength(1)
    expect(result.dailyModelTokens[0]).toEqual({
      date: '2026-04-30',
      tokensByModel: { 'claude-opus': 1000 },
    })
  })

  test('same date + same model: token counts SUMMED', () => {
    const cache = {
      ...emptyCache(),
      dailyModelTokens: [
        { date: '2026-04-30', tokensByModel: { 'claude-opus': 500 } },
      ],
    }
    const result = mergeCacheWithNewStats(
      cache,
      {
        ...emptyNewStats(),
        dailyModelTokens: [
          { date: '2026-04-30', tokensByModel: { 'claude-opus': 700 } },
        ],
      },
      '2026-04-30',
    )
    expect(result.dailyModelTokens[0]?.tokensByModel['claude-opus']).toBe(1200)
  })

  test('same date + different model: kept side-by-side', () => {
    const cache = {
      ...emptyCache(),
      dailyModelTokens: [
        { date: '2026-04-30', tokensByModel: { 'claude-opus': 500 } },
      ],
    }
    const result = mergeCacheWithNewStats(
      cache,
      {
        ...emptyNewStats(),
        dailyModelTokens: [
          { date: '2026-04-30', tokensByModel: { 'claude-sonnet': 300 } },
        ],
      },
      '2026-04-30',
    )
    expect(result.dailyModelTokens[0]?.tokensByModel).toEqual({
      'claude-opus': 500,
      'claude-sonnet': 300,
    })
  })
})

describe('mergeCacheWithNewStats — model usage', () => {
  test('new model added when not in cache', () => {
    const result = mergeCacheWithNewStats(
      emptyCache(),
      {
        ...emptyNewStats(),
        modelUsage: { 'claude-opus': sampleUsage() },
      },
      '2026-04-30',
    )
    expect(result.modelUsage['claude-opus']).toEqual(sampleUsage())
  })

  test('existing model usage SUMMED for additive fields', () => {
    const cache = {
      ...emptyCache(),
      modelUsage: { 'claude-opus': sampleUsage() },
    }
    const result = mergeCacheWithNewStats(
      cache,
      {
        ...emptyNewStats(),
        modelUsage: { 'claude-opus': sampleUsage() },
      },
      '2026-04-30',
    )
    const merged = result.modelUsage['claude-opus']!
    expect(merged.inputTokens).toBe(200) // 100+100
    expect(merged.outputTokens).toBe(400)
    expect(merged.cacheReadInputTokens).toBe(100)
    expect(merged.costUSD).toBe(0.02)
  })

  test('contextWindow + maxOutputTokens use Math.max (not sum)', () => {
    // Documented: limits don't add up — keep the larger.
    const cache = {
      ...emptyCache(),
      modelUsage: {
        'claude-opus': { ...sampleUsage(), contextWindow: 200_000, maxOutputTokens: 8_192 },
      },
    }
    const result = mergeCacheWithNewStats(
      cache,
      {
        ...emptyNewStats(),
        modelUsage: {
          'claude-opus': { ...sampleUsage(), contextWindow: 1_000_000, maxOutputTokens: 32_000 },
        },
      },
      '2026-04-30',
    )
    const merged = result.modelUsage['claude-opus']!
    expect(merged.contextWindow).toBe(1_000_000)
    expect(merged.maxOutputTokens).toBe(32_000)
  })
})

describe('mergeCacheWithNewStats — hour counts', () => {
  test('new hour counts added', () => {
    const result = mergeCacheWithNewStats(
      emptyCache(),
      { ...emptyNewStats(), hourCounts: { 9: 5, 14: 10 } },
      '2026-04-30',
    )
    expect(result.hourCounts).toEqual({ 9: 5, 14: 10 })
  })

  test('existing hour counts SUMMED', () => {
    const cache = { ...emptyCache(), hourCounts: { 9: 5 } }
    const result = mergeCacheWithNewStats(
      cache,
      { ...emptyNewStats(), hourCounts: { 9: 7, 14: 3 } },
      '2026-04-30',
    )
    expect(result.hourCounts).toEqual({ 9: 12, 14: 3 })
  })
})

describe('mergeCacheWithNewStats — session aggregates', () => {
  test('totalSessions + totalMessages SUMMED', () => {
    const cache = { ...emptyCache(), totalSessions: 10, totalMessages: 100 }
    const result = mergeCacheWithNewStats(
      cache,
      {
        ...emptyNewStats(),
        sessionStats: [
          { sessionId: 's1', duration: 1000, messageCount: 5, timestamp: '2026-04-30T10:00:00Z' },
          { sessionId: 's2', duration: 2000, messageCount: 10, timestamp: '2026-04-30T11:00:00Z' },
        ],
      },
      '2026-04-30',
    )
    expect(result.totalSessions).toBe(12)
    expect(result.totalMessages).toBe(115)
  })

  test('longestSession picked from new stats when longer', () => {
    const cache = {
      ...emptyCache(),
      longestSession: { sessionId: 'old', duration: 1000, messageCount: 5, timestamp: '2026-04-29T10:00:00Z' },
    }
    const result = mergeCacheWithNewStats(
      cache,
      {
        ...emptyNewStats(),
        sessionStats: [
          { sessionId: 'new', duration: 5000, messageCount: 20, timestamp: '2026-04-30T10:00:00Z' },
        ],
      },
      '2026-04-30',
    )
    expect(result.longestSession?.sessionId).toBe('new')
    expect(result.longestSession?.duration).toBe(5000)
  })

  test('longestSession kept from cache when cache value is longer', () => {
    const cache = {
      ...emptyCache(),
      longestSession: { sessionId: 'old', duration: 9999, messageCount: 5, timestamp: '2026-04-29T10:00:00Z' },
    }
    const result = mergeCacheWithNewStats(
      cache,
      {
        ...emptyNewStats(),
        sessionStats: [
          { sessionId: 'new', duration: 1000, messageCount: 5, timestamp: '2026-04-30T10:00:00Z' },
        ],
      },
      '2026-04-30',
    )
    expect(result.longestSession?.sessionId).toBe('old')
  })

  test('firstSessionDate uses earliest timestamp seen', () => {
    const cache = { ...emptyCache(), firstSessionDate: '2026-04-30T10:00:00Z' }
    const result = mergeCacheWithNewStats(
      cache,
      {
        ...emptyNewStats(),
        sessionStats: [
          { sessionId: 'older', duration: 100, messageCount: 1, timestamp: '2026-04-25T10:00:00Z' },
        ],
      },
      '2026-04-30',
    )
    expect(result.firstSessionDate).toBe('2026-04-25T10:00:00Z')
  })

  test('totalSpeculationTimeSavedMs SUMMED', () => {
    const cache = { ...emptyCache(), totalSpeculationTimeSavedMs: 1000 }
    const result = mergeCacheWithNewStats(
      cache,
      { ...emptyNewStats(), totalSpeculationTimeSavedMs: 500 },
      '2026-04-30',
    )
    expect(result.totalSpeculationTimeSavedMs).toBe(1500)
  })
})

describe('mergeCacheWithNewStats — version', () => {
  test('result.version always uses the current cache version', () => {
    // Older caches that get migrated will have their version set on
    // load, but the merger always emits the latest schema version.
    const result = mergeCacheWithNewStats(emptyCache(), emptyNewStats(), '2026-04-30')
    expect(result.version).toBe(3) // STATS_CACHE_VERSION constant
  })
})
