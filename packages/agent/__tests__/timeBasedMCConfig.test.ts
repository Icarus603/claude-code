import { describe, expect, mock, test } from 'bun:test'
import {
  TIME_BASED_MC_CONFIG_DEFAULTS,
  getTimeBasedMCConfig,
} from '../compaction/timeBasedMCConfig.js'

describe('TIME_BASED_MC_CONFIG_DEFAULTS — contract anchor', () => {
  // These defaults gate when time-based microcompact fires. They form
  // the "fail-safe" baseline when GrowthBook is unavailable. If any
  // value drifts unintentionally, microcompact behavior changes silently
  // for users on first launch (before GrowthBook cache populates).

  test('enabled defaults to false', () => {
    // Critical: GrowthBook-gated feature MUST default off. If a refactor
    // flips this to true, the feature becomes "enabled-by-default" and
    // breaks the kill-switch model.
    expect(TIME_BASED_MC_CONFIG_DEFAULTS.enabled).toBe(false)
  })

  test('gapThresholdMinutes is 60 (1 hour)', () => {
    // Why 60: matches Anthropic prompt-cache TTL. A gap >60min means
    // the cache is dead anyway, so microcompacting at that boundary
    // doesn't bust an otherwise-warm cache.
    expect(TIME_BASED_MC_CONFIG_DEFAULTS.gapThresholdMinutes).toBe(60)
  })

  test('keepRecent is 5', () => {
    expect(TIME_BASED_MC_CONFIG_DEFAULTS.keepRecent).toBe(5)
  })

  test('config has exactly 3 fields (no silent additions)', () => {
    // Catches refactors that add a field without updating callers.
    expect(Object.keys(TIME_BASED_MC_CONFIG_DEFAULTS).length).toBe(3)
  })
})

describe('getTimeBasedMCConfig', () => {
  test('reads "tengu_slate_heron" GrowthBook key', () => {
    const getFeatureValue = mock(<T,>(_k: string, defaultValue: T): T => defaultValue)
    getTimeBasedMCConfig({ getFeatureValue })
    expect(getFeatureValue).toHaveBeenCalledTimes(1)
    expect(getFeatureValue.mock.calls[0]?.[0]).toBe('tengu_slate_heron')
  })

  test('passes TIME_BASED_MC_CONFIG_DEFAULTS as the fallback', () => {
    const getFeatureValue = mock(<T,>(_k: string, defaultValue: T): T => defaultValue)
    getTimeBasedMCConfig({ getFeatureValue })
    expect(getFeatureValue.mock.calls[0]?.[1]).toBe(TIME_BASED_MC_CONFIG_DEFAULTS)
  })

  test('returns the defaults when GrowthBook returns the fallback', () => {
    const result = getTimeBasedMCConfig({
      getFeatureValue: <T,>(_k: string, defaultValue: T) => defaultValue,
    })
    expect(result).toBe(TIME_BASED_MC_CONFIG_DEFAULTS)
  })

  test('returns the GrowthBook value when one is provided', () => {
    const customConfig = {
      enabled: true,
      gapThresholdMinutes: 30,
      keepRecent: 10,
    }
    const result = getTimeBasedMCConfig({
      getFeatureValue: <T,>(_k: string, _defaultValue: T) =>
        customConfig as unknown as T,
    })
    expect(result).toEqual(customConfig)
  })

  test('exposure fires unconditionally (not behind a guard)', () => {
    // Critical for telemetry: GrowthBook A/B exposure tracking depends
    // on the read happening on every code path. If a future refactor
    // wraps it in `if (someCondition)`, the experiment data becomes
    // biased. The contract is "always read, always expose".
    const getFeatureValue = mock(<T,>(_k: string, defaultValue: T): T => defaultValue)
    for (let i = 0; i < 10; i++) {
      getTimeBasedMCConfig({ getFeatureValue })
    }
    expect(getFeatureValue).toHaveBeenCalledTimes(10)
  })

  test('does not memoize — each call hits the GrowthBook read', () => {
    // Same as above but verifies explicitly: the function deliberately
    // does NOT cache its own result. Caching is GrowthBook's job.
    let callCount = 0
    const getFeatureValue = <T,>(_k: string, defaultValue: T): T => {
      callCount++
      return defaultValue
    }
    getTimeBasedMCConfig({ getFeatureValue })
    getTimeBasedMCConfig({ getFeatureValue })
    expect(callCount).toBe(2)
  })
})
