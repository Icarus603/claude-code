import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock the feature flag accessor before importing SUT.
const realFf = await import('@claude-code/config/feature-flags')
let featureValue: unknown = undefined

mock.module('@claude-code/config/feature-flags', () => ({
  ...realFf,
  getFeatureValue_CACHED_WITH_REFRESH: <T>(
    _key: string,
    fallback: T,
    _refreshMs: number,
  ): T => {
    return featureValue !== undefined ? (featureValue as T) : fallback
  },
}))

const { getCronJitterConfig } = await import(
  '../misc/cronJitterConfig.js'
)
const { DEFAULT_CRON_JITTER_CONFIG } = await import('../scheduler.js')

beforeEach(() => {
  featureValue = undefined
})

describe('getCronJitterConfig — defaults', () => {
  test('no GB entry → DEFAULT_CRON_JITTER_CONFIG', () => {
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('DEFAULT_CRON_JITTER_CONFIG snapshot — incident-recovery anchor', () => {
    // The defaults are operational levers. Pinning them here ensures
    // an accidental edit gets caught by tests rather than a production
    // incident at the next :00 boundary.
    expect(DEFAULT_CRON_JITTER_CONFIG).toEqual({
      recurringFrac: 0.1,
      recurringCapMs: 15 * 60 * 1000,
      oneShotMaxMs: 90 * 1000,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 30,
      recurringMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
    })
  })
})

describe('getCronJitterConfig — valid GB payload', () => {
  test('passes through a valid full config', () => {
    const valid = {
      recurringFrac: 0.5,
      recurringCapMs: 60_000,
      oneShotMaxMs: 30_000,
      oneShotFloorMs: 5_000,
      oneShotMinuteMod: 15,
      recurringMaxAgeMs: 24 * 60 * 60 * 1000,
    }
    featureValue = valid
    expect(getCronJitterConfig()).toEqual(valid)
  })

  test('partial config WITHOUT recurringMaxAgeMs gets default for that field', () => {
    // recurringMaxAgeMs has a `.default(DEFAULT.recurringMaxAgeMs)` so
    // configs from before this field was added don't get rejected.
    // Other fields don't have defaults; a missing field rejects the whole.
    const partial = {
      recurringFrac: 0.5,
      recurringCapMs: 60_000,
      oneShotMaxMs: 30_000,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 30,
      // no recurringMaxAgeMs
    }
    featureValue = partial
    expect(getCronJitterConfig()).toEqual({
      ...partial,
      recurringMaxAgeMs: DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs,
    })
  })
})

describe('getCronJitterConfig — invalid GB payload falls back to defaults', () => {
  // Critical: any single field violation rejects the WHOLE config.
  // This is intentional defense-in-depth against fat-fingered GB pushes.

  test('fully missing field (e.g. recurringFrac) → defaults', () => {
    featureValue = {
      recurringCapMs: 60_000,
      oneShotMaxMs: 30_000,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 30,
      recurringMaxAgeMs: 60_000,
    } // no recurringFrac
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('recurringFrac out of range (> 1) → defaults', () => {
    featureValue = {
      recurringFrac: 1.5, // > 1
      recurringCapMs: 60_000,
      oneShotMaxMs: 30_000,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 30,
      recurringMaxAgeMs: 60_000,
    }
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('recurringFrac negative → defaults', () => {
    featureValue = {
      recurringFrac: -0.1,
      recurringCapMs: 60_000,
      oneShotMaxMs: 30_000,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 30,
      recurringMaxAgeMs: 60_000,
    }
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('recurringCapMs above HALF_HOUR_MS upper bound → defaults', () => {
    // The upper bound prevents jitter from disrupting the recurring schedule.
    featureValue = {
      recurringFrac: 0.5,
      recurringCapMs: 60 * 60 * 1000, // 1 hour > HALF_HOUR_MS
      oneShotMaxMs: 30_000,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 30,
      recurringMaxAgeMs: 60_000,
    }
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('non-integer ms field → defaults', () => {
    featureValue = {
      recurringFrac: 0.5,
      recurringCapMs: 60_000.5, // non-integer
      oneShotMaxMs: 30_000,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 30,
      recurringMaxAgeMs: 60_000,
    }
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('oneShotMinuteMod out of [1, 60] → defaults', () => {
    featureValue = {
      recurringFrac: 0.5,
      recurringCapMs: 60_000,
      oneShotMaxMs: 30_000,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 0, // < 1
      recurringMaxAgeMs: 60_000,
    }
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('oneShotMinuteMod = 61 → defaults', () => {
    featureValue = {
      recurringFrac: 0.5,
      recurringCapMs: 60_000,
      oneShotMaxMs: 30_000,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 61, // > 60
      recurringMaxAgeMs: 60_000,
    }
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('CRITICAL — oneShotFloorMs > oneShotMaxMs (refine fail) → defaults', () => {
    // The .refine() rule prevents an inverted jitter range.
    // Without this, jitter would have negative duration → bug.
    featureValue = {
      recurringFrac: 0.5,
      recurringCapMs: 60_000,
      oneShotMaxMs: 5_000,
      oneShotFloorMs: 30_000, // floor > max
      oneShotMinuteMod: 30,
      recurringMaxAgeMs: 60_000,
    }
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('oneShotFloorMs == oneShotMaxMs is allowed (boundary equal)', () => {
    // The refine is `oneShotFloorMs <= oneShotMaxMs`. Equal is OK.
    const valid = {
      recurringFrac: 0.5,
      recurringCapMs: 60_000,
      oneShotMaxMs: 5_000,
      oneShotFloorMs: 5_000, // floor == max
      oneShotMinuteMod: 30,
      recurringMaxAgeMs: 60_000,
    }
    featureValue = valid
    expect(getCronJitterConfig()).toEqual(valid)
  })

  test('non-object payload → defaults', () => {
    featureValue = 'not an object'
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('null payload → defaults', () => {
    featureValue = null
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('array payload → defaults', () => {
    featureValue = ['array', 'not', 'object']
    expect(getCronJitterConfig()).toEqual(DEFAULT_CRON_JITTER_CONFIG)
  })

  test('extra unknown fields are ignored (zod default)', () => {
    // Documents that extra fields don't cause rejection. The validated
    // shape only includes the documented fields.
    featureValue = {
      recurringFrac: 0.5,
      recurringCapMs: 60_000,
      oneShotMaxMs: 30_000,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 30,
      recurringMaxAgeMs: 60_000,
      newFieldFromFuture: 'ignored',
    }
    const result = getCronJitterConfig()
    expect(result.recurringFrac).toBe(0.5)
    expect((result as Record<string, unknown>).newFieldFromFuture).toBeUndefined()
  })
})
