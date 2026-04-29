import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CACHED_MC_CONFIG,
  getCachedMCConfig,
} from '../compaction/cachedMCConfig.js'

describe('DEFAULT_CACHED_MC_CONFIG — contract anchor', () => {
  test('enabled=true (this is an opt-out feature, not opt-in)', () => {
    expect(DEFAULT_CACHED_MC_CONFIG.enabled).toBe(true)
  })

  test('triggerThreshold=20', () => {
    expect(DEFAULT_CACHED_MC_CONFIG.triggerThreshold).toBe(20)
  })

  test('keepRecent=5', () => {
    expect(DEFAULT_CACHED_MC_CONFIG.keepRecent).toBe(5)
  })

  test('supportedModels covers Claude 3.5/3.7/4 sonnet + opus families', () => {
    expect(DEFAULT_CACHED_MC_CONFIG.supportedModels).toContain(
      'claude-sonnet-4',
    )
    expect(DEFAULT_CACHED_MC_CONFIG.supportedModels).toContain('claude-opus-4')
    expect(DEFAULT_CACHED_MC_CONFIG.supportedModels).toContain(
      'claude-3-5-sonnet',
    )
    expect(DEFAULT_CACHED_MC_CONFIG.supportedModels).toContain(
      'claude-3-7-sonnet',
    )
  })

  test('systemPromptSuggestSummaries defaults false', () => {
    expect(DEFAULT_CACHED_MC_CONFIG.systemPromptSuggestSummaries).toBe(false)
  })
})

describe('getCachedMCConfig — env override path', () => {
  // When CLAUDE_CACHED_MC_ENABLED is set, the env-override path is
  // taken — bypasses GrowthBook entirely. Critical: this lets ops
  // turn off cached microcompact in incidents without GB rollback.

  test('env enabled="1" → enabled=true', () => {
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, fallback: T) => fallback,
      getEnv: (k: string) => (k === 'CLAUDE_CACHED_MC_ENABLED' ? '1' : undefined),
    })
    expect(result.enabled).toBe(true)
  })

  test('env enabled="0" → enabled=false (explicit kill)', () => {
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, fallback: T) => fallback,
      getEnv: (k: string) => (k === 'CLAUDE_CACHED_MC_ENABLED' ? '0' : undefined),
    })
    expect(result.enabled).toBe(false)
  })

  test('env enabled="true" (string "true") → enabled=false (only "1" qualifies)', () => {
    // Critical: the check is `envEnabled === '1'`, NOT a truthy check.
    // String "true" is NOT equal to "1" — so it falls into the false
    // branch. Catches a refactor that uses isEnvTruthy() (which would
    // accept "true").
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, fallback: T) => fallback,
      getEnv: (k: string) =>
        k === 'CLAUDE_CACHED_MC_ENABLED' ? 'true' : undefined,
    })
    expect(result.enabled).toBe(false)
  })

  test('env override path uses default supportedModels (NOT customizable via env)', () => {
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, fallback: T) => fallback,
      getEnv: (k: string) => (k === 'CLAUDE_CACHED_MC_ENABLED' ? '1' : undefined),
    })
    expect(result.supportedModels).toBe(DEFAULT_CACHED_MC_CONFIG.supportedModels)
  })

  test('env triggerThreshold parsed numerically', () => {
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, fallback: T) => fallback,
      getEnv: (k: string) => {
        if (k === 'CLAUDE_CACHED_MC_ENABLED') return '1'
        if (k === 'CLAUDE_CACHED_MC_TRIGGER') return '50'
        return undefined
      },
    })
    expect(result.triggerThreshold).toBe(50)
  })

  test('env triggerThreshold falls back to default when invalid', () => {
    // parseInt('invalid', 10) = NaN. `NaN || default` = default.
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, fallback: T) => fallback,
      getEnv: (k: string) => {
        if (k === 'CLAUDE_CACHED_MC_ENABLED') return '1'
        if (k === 'CLAUDE_CACHED_MC_TRIGGER') return 'invalid'
        return undefined
      },
    })
    expect(result.triggerThreshold).toBe(
      DEFAULT_CACHED_MC_CONFIG.triggerThreshold,
    )
  })

  test('env triggerThreshold "0" falls back (because 0 is falsy with || operator)', () => {
    // Documents the `|| default` pattern: 0 is falsy, so user can't
    // disable trigger via setting to 0. They'd need to set enabled=0.
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, fallback: T) => fallback,
      getEnv: (k: string) => {
        if (k === 'CLAUDE_CACHED_MC_ENABLED') return '1'
        if (k === 'CLAUDE_CACHED_MC_TRIGGER') return '0'
        return undefined
      },
    })
    expect(result.triggerThreshold).toBe(
      DEFAULT_CACHED_MC_CONFIG.triggerThreshold,
    )
  })

  test('env keepRecent parsed numerically', () => {
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, fallback: T) => fallback,
      getEnv: (k: string) => {
        if (k === 'CLAUDE_CACHED_MC_ENABLED') return '1'
        if (k === 'CLAUDE_CACHED_MC_KEEP_RECENT') return '10'
        return undefined
      },
    })
    expect(result.keepRecent).toBe(10)
  })

  test('env systemPromptSuggestSummaries="1" → true', () => {
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, fallback: T) => fallback,
      getEnv: (k: string) => {
        if (k === 'CLAUDE_CACHED_MC_ENABLED') return '1'
        if (k === 'CLAUDE_CACHED_MC_SUGGEST_SUMMARIES') return '1'
        return undefined
      },
    })
    expect(result.systemPromptSuggestSummaries).toBe(true)
  })

  test('env systemPromptSuggestSummaries unset → false (default)', () => {
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, fallback: T) => fallback,
      getEnv: (k: string) => (k === 'CLAUDE_CACHED_MC_ENABLED' ? '1' : undefined),
    })
    expect(result.systemPromptSuggestSummaries).toBe(false)
  })
})

describe('getCachedMCConfig — GrowthBook fallback', () => {
  test('reads "tengu_cached_microcompact" key when env unset', () => {
    let readKey = ''
    getCachedMCConfig({
      getFeatureValue: <T,>(k: string, fallback: T) => {
        readKey = k
        return fallback
      },
      getEnv: () => undefined,
    })
    expect(readKey).toBe('tengu_cached_microcompact')
  })

  test('passes DEFAULT_CACHED_MC_CONFIG as fallback', () => {
    let passedFallback: unknown = null
    getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, fallback: T) => {
        passedFallback = fallback
        return fallback
      },
      getEnv: () => undefined,
    })
    expect(passedFallback).toBe(DEFAULT_CACHED_MC_CONFIG)
  })

  test('returns GrowthBook value when one is provided', () => {
    const customConfig = {
      enabled: false,
      triggerThreshold: 99,
      keepRecent: 99,
      supportedModels: ['custom-model'],
      systemPromptSuggestSummaries: true,
    }
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, _fallback: T) => customConfig as unknown as T,
      getEnv: () => undefined,
    })
    expect(result).toEqual(customConfig)
  })

  test('null GrowthBook value falls back to default', () => {
    // Documents the `?? DEFAULT_CACHED_MC_CONFIG` guard. If GrowthBook
    // misbehaves and returns null, we get safe defaults instead of
    // crashing on `.enabled` access.
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, _fallback: T) => null as unknown as T,
      getEnv: () => undefined,
    })
    expect(result).toBe(DEFAULT_CACHED_MC_CONFIG)
  })
})

describe('getCachedMCConfig — env path PRIORITY over GrowthBook', () => {
  test('env enabled set → GrowthBook value is IGNORED', () => {
    const gbConfig = {
      enabled: false,
      triggerThreshold: 999,
      keepRecent: 999,
      supportedModels: [],
      systemPromptSuggestSummaries: true,
    }
    const result = getCachedMCConfig({
      getFeatureValue: <T,>(_k: string, _fb: T) => gbConfig as unknown as T,
      getEnv: (k: string) => (k === 'CLAUDE_CACHED_MC_ENABLED' ? '1' : undefined),
    })
    // Env path wins.
    expect(result.enabled).toBe(true)
    expect(result.triggerThreshold).toBe(
      DEFAULT_CACHED_MC_CONFIG.triggerThreshold,
    )
  })
})
