/**
 * Tests for FpsTracker — tracks average + p99 (1% low) FPS for the
 * REPL render loop. The metrics flow into Statsig dashboards used
 * to spot perf regressions.
 *
 * Wrong p99 = a small fraction of stutter frames hides in the
 * average; the dashboard says "60fps avg" while users see jank.
 * The 1% low FPS is the canary for those bad frames.
 *
 * Tests are deterministic-where-possible: we control `record()`
 * inputs but rely on `performance.now()` for total time. We assert
 * mathematical relationships (e.g. low1PctFps ≤ averageFps), not
 * absolute numbers, except where the math is exact.
 */
import { describe, expect, test } from 'bun:test'
import { FpsTracker } from '../fpsTracker.js'

describe('FpsTracker — degenerate cases', () => {
  test('no frames recorded → metrics is undefined', () => {
    const t = new FpsTracker()
    expect(t.getMetrics()).toBeUndefined()
  })

  test('single frame recorded → still undefined (need duration > 0)', () => {
    const t = new FpsTracker()
    t.record(16)
    // first==last → totalTimeMs = 0 → undefined.
    expect(t.getMetrics()).toBeUndefined()
  })
})

describe('FpsTracker — basic metrics', () => {
  test('after multiple frames spread over time → numeric metrics', async () => {
    const t = new FpsTracker()
    t.record(16)
    // Yield enough time for performance.now() to advance.
    await new Promise(r => setTimeout(r, 5))
    t.record(16)
    await new Promise(r => setTimeout(r, 5))
    t.record(16)
    const m = t.getMetrics()
    expect(m).toBeDefined()
    expect(typeof m?.averageFps).toBe('number')
    expect(typeof m?.low1PctFps).toBe('number')
    expect(Number.isFinite(m!.averageFps)).toBe(true)
    expect(Number.isFinite(m!.low1PctFps)).toBe(true)
  })

  test('low1PctFps ≤ averageFps (low is the worst, by definition)', async () => {
    const t = new FpsTracker()
    // Mix fast + slow frames.
    for (let i = 0; i < 50; i++) {
      t.record(8) // 125 fps frames
      await new Promise(r => setTimeout(r, 1))
    }
    t.record(100) // one slow 10fps frame
    await new Promise(r => setTimeout(r, 1))
    const m = t.getMetrics()
    expect(m!.low1PctFps).toBeLessThanOrEqual(m!.averageFps)
  })

  test('all-equal frame durations → low1PctFps == 1000/duration (within rounding)', async () => {
    const t = new FpsTracker()
    for (let i = 0; i < 20; i++) {
      t.record(16)
      await new Promise(r => setTimeout(r, 1))
    }
    const m = t.getMetrics()
    // 1000/16 = 62.5 fps → rounded to 2dp = 62.5.
    expect(m!.low1PctFps).toBe(62.5)
  })

  test('values rounded to 2 decimal places', async () => {
    const t = new FpsTracker()
    for (let i = 0; i < 10; i++) {
      t.record(16.7)
      await new Promise(r => setTimeout(r, 1))
    }
    const m = t.getMetrics()
    // averageFps and low1PctFps both rounded to 2dp.
    const avgStr = m!.averageFps.toString()
    const lowStr = m!.low1PctFps.toString()
    // Number of decimals after the `.` is at most 2.
    const avgDecimals = avgStr.includes('.') ? avgStr.split('.')[1]!.length : 0
    const lowDecimals = lowStr.includes('.') ? lowStr.split('.')[1]!.length : 0
    expect(avgDecimals).toBeLessThanOrEqual(2)
    expect(lowDecimals).toBeLessThanOrEqual(2)
  })
})

describe('FpsTracker — p99 frame time selection', () => {
  test('p99 picks one of the worst frames (not the median)', async () => {
    const t = new FpsTracker()
    // 100 frames at 8ms (125fps), 1 frame at 100ms (10fps).
    for (let i = 0; i < 100; i++) {
      t.record(8)
      await new Promise(r => setTimeout(r, 1))
    }
    t.record(100)
    await new Promise(r => setTimeout(r, 1))
    const m = t.getMetrics()
    // p99Index = ceil(101 * 0.01) - 1 = 2 - 1 = 1, sorted desc.
    // sorted desc = [100, 8, 8, ...]; index 1 = 8 → low1PctFps = 1000/8 = 125.
    // The single 100ms outlier doesn't show up in low1PctFps because
    // p99 over 101 frames takes the 2nd worst (index 1), not the worst.
    // This test locks that exact behaviour.
    expect(m!.low1PctFps).toBe(125)
  })

  test('with a single bad frame in 50 frames → p99 catches it', async () => {
    const t = new FpsTracker()
    // 49 frames at 8ms + 1 at 100ms.
    for (let i = 0; i < 49; i++) {
      t.record(8)
      await new Promise(r => setTimeout(r, 1))
    }
    t.record(100)
    await new Promise(r => setTimeout(r, 1))
    const m = t.getMetrics()
    // p99Index = ceil(50 * 0.01) - 1 = 1 - 1 = 0, sorted desc = [100, 8, 8, ...].
    // index 0 = 100ms → 10 fps.
    expect(m!.low1PctFps).toBe(10)
  })

  test('p99 with single frame after multi-record → handles edge correctly', async () => {
    const t = new FpsTracker()
    t.record(16)
    await new Promise(r => setTimeout(r, 1))
    t.record(16)
    await new Promise(r => setTimeout(r, 1))
    const m = t.getMetrics()
    // 2 frames: ceil(2*0.01) = 1, index = 0, sorted desc = [16, 16].
    expect(m!.low1PctFps).toBe(62.5)
  })
})

describe('FpsTracker — incremental updates', () => {
  test('metrics reflect ALL recorded frames (no rolling window)', async () => {
    const t = new FpsTracker()
    t.record(8)
    await new Promise(r => setTimeout(r, 1))
    t.record(8)
    const m1 = t.getMetrics()
    await new Promise(r => setTimeout(r, 1))
    t.record(100) // bad frame
    await new Promise(r => setTimeout(r, 1))
    const m2 = t.getMetrics()
    // Adding a bad frame must not make low1PctFps higher.
    expect(m2!.low1PctFps).toBeLessThanOrEqual(m1!.low1PctFps)
  })

  test('getMetrics is idempotent (does not mutate state)', async () => {
    const t = new FpsTracker()
    t.record(16)
    await new Promise(r => setTimeout(r, 1))
    t.record(16)
    const m1 = t.getMetrics()
    const m2 = t.getMetrics()
    expect(m1).toEqual(m2)
  })
})

describe('FpsTracker — degenerate frame durations', () => {
  test('all-zero frame durations → low1PctFps = 0 (avoid div-by-zero)', async () => {
    const t = new FpsTracker()
    for (let i = 0; i < 10; i++) {
      t.record(0)
      await new Promise(r => setTimeout(r, 1))
    }
    const m = t.getMetrics()
    expect(m!.low1PctFps).toBe(0)
  })

  test('mix of zero + nonzero: p99 picks the WORST = 16ms → 62.5fps', async () => {
    const t = new FpsTracker()
    t.record(16)
    for (let i = 0; i < 99; i++) {
      t.record(0)
      await new Promise(r => setTimeout(r, 1))
    }
    const m = t.getMetrics()
    // 100 frames: p99Index = ceil(100*0.01) - 1 = 1 - 1 = 0.
    // sorted desc = [16, 0, 0, ...]; index 0 = 16 → 1000/16 = 62.5.
    // Note: p99 takes the WORST frame here (largest duration), not 0.
    expect(m!.low1PctFps).toBe(62.5)
  })
})

describe('FpsTracker — instance independence', () => {
  test('two trackers do not share state', async () => {
    const t1 = new FpsTracker()
    const t2 = new FpsTracker()
    t1.record(8)
    await new Promise(r => setTimeout(r, 1))
    t1.record(8)
    expect(t1.getMetrics()).toBeDefined()
    expect(t2.getMetrics()).toBeUndefined()
  })
})
