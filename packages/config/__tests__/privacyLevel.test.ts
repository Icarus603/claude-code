/**
 * Tests for privacy-level helpers — controls how much nonessential
 * network traffic Claude Code generates. The resolved level is the
 * MOST RESTRICTIVE signal from env vars; a regression that flips
 * the priority either leaks telemetry users opted out of OR blocks
 * traffic users wanted enabled.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getEssentialTrafficOnlyReason,
  getPrivacyLevel,
  isEssentialTrafficOnly,
  isTelemetryDisabled,
} from '../env/privacy-level.js'

const ENV_VARS = [
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'DISABLE_TELEMETRY',
] as const

describe('getPrivacyLevel — env precedence', () => {
  beforeEach(() => {
    for (const v of ENV_VARS) delete process.env[v]
  })
  afterEach(() => {
    for (const v of ENV_VARS) delete process.env[v]
  })

  test('no env vars → "default"', () => {
    expect(getPrivacyLevel()).toBe('default')
  })

  test('DISABLE_TELEMETRY=1 → "no-telemetry"', () => {
    process.env.DISABLE_TELEMETRY = '1'
    expect(getPrivacyLevel()).toBe('no-telemetry')
  })

  test('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 → "essential-traffic"', () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    expect(getPrivacyLevel()).toBe('essential-traffic')
  })

  test('NONESSENTIAL takes precedence over DISABLE_TELEMETRY', () => {
    // Documented: most restrictive wins.
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    process.env.DISABLE_TELEMETRY = '1'
    expect(getPrivacyLevel()).toBe('essential-traffic')
  })

  test('DISABLE_TELEMETRY any truthy value → "no-telemetry"', () => {
    // The function uses readEnv() which is truthy-check (not strict
    // "true"). Any non-empty string flips the gate.
    process.env.DISABLE_TELEMETRY = 'yes'
    expect(getPrivacyLevel()).toBe('no-telemetry')
  })
})

describe('isEssentialTrafficOnly', () => {
  beforeEach(() => {
    for (const v of ENV_VARS) delete process.env[v]
  })
  afterEach(() => {
    for (const v of ENV_VARS) delete process.env[v]
  })

  test('default → false', () => {
    expect(isEssentialTrafficOnly()).toBe(false)
  })

  test('no-telemetry → false (NOT also essential-only)', () => {
    process.env.DISABLE_TELEMETRY = '1'
    expect(isEssentialTrafficOnly()).toBe(false)
  })

  test('essential-traffic → true', () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    expect(isEssentialTrafficOnly()).toBe(true)
  })
})

describe('isTelemetryDisabled', () => {
  beforeEach(() => {
    for (const v of ENV_VARS) delete process.env[v]
  })
  afterEach(() => {
    for (const v of ENV_VARS) delete process.env[v]
  })

  test('default → false', () => {
    expect(isTelemetryDisabled()).toBe(false)
  })

  test('no-telemetry → true', () => {
    process.env.DISABLE_TELEMETRY = '1'
    expect(isTelemetryDisabled()).toBe(true)
  })

  test('essential-traffic → true (subsumes no-telemetry)', () => {
    // Documented: telemetry disabled at both no-telemetry AND
    // essential-traffic levels. Lock the cascade.
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    expect(isTelemetryDisabled()).toBe(true)
  })
})

describe('getEssentialTrafficOnlyReason', () => {
  beforeEach(() => {
    for (const v of ENV_VARS) delete process.env[v]
  })
  afterEach(() => {
    for (const v of ENV_VARS) delete process.env[v]
  })

  test('no env → null', () => {
    expect(getEssentialTrafficOnlyReason()).toBeNull()
  })

  test('DISABLE_TELEMETRY only → null (not essential-traffic level)', () => {
    process.env.DISABLE_TELEMETRY = '1'
    expect(getEssentialTrafficOnlyReason()).toBeNull()
  })

  test('NONESSENTIAL set → returns env var name verbatim', () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    expect(getEssentialTrafficOnlyReason()).toBe(
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    )
  })

  test('Both env vars set → returns NONESSENTIAL (the higher-precedence one)', () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    process.env.DISABLE_TELEMETRY = '1'
    expect(getEssentialTrafficOnlyReason()).toBe(
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    )
  })
})
