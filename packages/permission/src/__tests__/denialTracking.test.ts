import { describe, expect, test } from 'bun:test'
import {
  createDenialTrackingState,
  DENIAL_LIMITS,
  recordDenial,
  recordSuccess,
  shouldFallbackToPrompting,
} from '../denialTracking.js'

describe('createDenialTrackingState', () => {
  test('starts with zero counters', () => {
    const s = createDenialTrackingState()
    expect(s.consecutiveDenials).toBe(0)
    expect(s.totalDenials).toBe(0)
  })
})

describe('recordDenial', () => {
  test('increments both counters', () => {
    const s1 = createDenialTrackingState()
    const s2 = recordDenial(s1)
    expect(s2.consecutiveDenials).toBe(1)
    expect(s2.totalDenials).toBe(1)
  })
  test('returns a new object (immutability)', () => {
    const s1 = createDenialTrackingState()
    const s2 = recordDenial(s1)
    expect(s2).not.toBe(s1)
    expect(s1.consecutiveDenials).toBe(0) // original unchanged
  })
  test('multiple denials accumulate', () => {
    let s = createDenialTrackingState()
    for (let i = 0; i < 5; i++) s = recordDenial(s)
    expect(s.consecutiveDenials).toBe(5)
    expect(s.totalDenials).toBe(5)
  })
})

describe('recordSuccess', () => {
  test('resets consecutiveDenials but preserves totalDenials', () => {
    let s = createDenialTrackingState()
    s = recordDenial(s)
    s = recordDenial(s)
    s = recordSuccess(s)
    expect(s.consecutiveDenials).toBe(0)
    expect(s.totalDenials).toBe(2)
  })
  test('returns same reference when consecutiveDenials is already 0 (perf optimization)', () => {
    const s = createDenialTrackingState()
    expect(recordSuccess(s)).toBe(s)
  })
})

describe('shouldFallbackToPrompting', () => {
  test('false at zero', () => {
    expect(shouldFallbackToPrompting(createDenialTrackingState())).toBe(false)
  })
  test('true at consecutive limit', () => {
    let s = createDenialTrackingState()
    for (let i = 0; i < DENIAL_LIMITS.maxConsecutive; i++) {
      s = recordDenial(s)
    }
    expect(shouldFallbackToPrompting(s)).toBe(true)
  })
  test('false just below consecutive limit', () => {
    let s = createDenialTrackingState()
    for (let i = 0; i < DENIAL_LIMITS.maxConsecutive - 1; i++) {
      s = recordDenial(s)
    }
    expect(shouldFallbackToPrompting(s)).toBe(false)
  })
  test('total limit triggers even after consecutive reset', () => {
    // Pattern: deny 3, succeed (resets consecutive), deny 17 more.
    // total = 20, consecutive = 17 — should still fallback because of total.
    // But maxConsecutive = 3, so consecutive=17 ALSO triggers; let's hit
    // total without crossing consecutive.
    let s = createDenialTrackingState()
    for (let cycle = 0; cycle < 10; cycle++) {
      // 2 denials each cycle, then a success — keeps consecutive at 0
      s = recordDenial(s)
      s = recordDenial(s)
      s = recordSuccess(s)
    }
    // After 10 cycles: total=20, consecutive=0
    expect(s.consecutiveDenials).toBe(0)
    expect(s.totalDenials).toBe(20)
    expect(shouldFallbackToPrompting(s)).toBe(true)
  })
})

describe('DENIAL_LIMITS', () => {
  test('declared as const (compile-time invariant)', () => {
    // const-asserted shape — values are fixed at module load
    expect(DENIAL_LIMITS.maxConsecutive).toBeGreaterThan(0)
    expect(DENIAL_LIMITS.maxTotal).toBeGreaterThan(DENIAL_LIMITS.maxConsecutive)
  })
})
