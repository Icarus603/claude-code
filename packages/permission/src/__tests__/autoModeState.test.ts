import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  _resetForTesting,
  getAutoModeFlagCli,
  isAutoModeActive,
  isAutoModeCircuitBroken,
  setAutoModeActive,
  setAutoModeCircuitBroken,
  setAutoModeFlagCli,
} from '../autoModeState.js'

beforeEach(() => {
  _resetForTesting()
})

afterEach(() => {
  _resetForTesting()
})

describe('autoModeActive', () => {
  test('initial state is false', () => {
    expect(isAutoModeActive()).toBe(false)
  })

  test('setAutoModeActive(true) → isAutoModeActive() returns true', () => {
    setAutoModeActive(true)
    expect(isAutoModeActive()).toBe(true)
  })

  test('setAutoModeActive(false) → isAutoModeActive() returns false', () => {
    setAutoModeActive(true)
    setAutoModeActive(false)
    expect(isAutoModeActive()).toBe(false)
  })

  test('repeated set is idempotent', () => {
    setAutoModeActive(true)
    setAutoModeActive(true)
    setAutoModeActive(true)
    expect(isAutoModeActive()).toBe(true)
  })
})

describe('autoModeFlagCli', () => {
  test('initial state is false', () => {
    expect(getAutoModeFlagCli()).toBe(false)
  })

  test('setAutoModeFlagCli(true) → getAutoModeFlagCli() returns true', () => {
    setAutoModeFlagCli(true)
    expect(getAutoModeFlagCli()).toBe(true)
  })

  test('setAutoModeFlagCli(false) → getAutoModeFlagCli() returns false', () => {
    setAutoModeFlagCli(true)
    setAutoModeFlagCli(false)
    expect(getAutoModeFlagCli()).toBe(false)
  })
})

describe('autoModeCircuitBroken', () => {
  test('initial state is false', () => {
    expect(isAutoModeCircuitBroken()).toBe(false)
  })

  test('setAutoModeCircuitBroken(true) → isAutoModeCircuitBroken() returns true', () => {
    setAutoModeCircuitBroken(true)
    expect(isAutoModeCircuitBroken()).toBe(true)
  })

  test('setAutoModeCircuitBroken(false) → unsets', () => {
    setAutoModeCircuitBroken(true)
    setAutoModeCircuitBroken(false)
    expect(isAutoModeCircuitBroken()).toBe(false)
  })
})

describe('three flags are independent (no cross-contamination)', () => {
  // Critical: the three flags are SEMANTICALLY distinct:
  // - active: am I currently in auto mode?
  // - flagCli: did the user start me with --auto?
  // - circuitBroken: has GrowthBook disabled auto mode mid-session?
  // A refactor that conflates them silently breaks gate logic.

  test('setting active does NOT change flagCli', () => {
    setAutoModeActive(true)
    expect(getAutoModeFlagCli()).toBe(false)
  })

  test('setting active does NOT change circuitBroken', () => {
    setAutoModeActive(true)
    expect(isAutoModeCircuitBroken()).toBe(false)
  })

  test('setting flagCli does NOT change active', () => {
    setAutoModeFlagCli(true)
    expect(isAutoModeActive()).toBe(false)
  })

  test('setting circuitBroken does NOT change active', () => {
    setAutoModeCircuitBroken(true)
    expect(isAutoModeActive()).toBe(false)
  })

  test('all three can be true simultaneously without interference', () => {
    setAutoModeActive(true)
    setAutoModeFlagCli(true)
    setAutoModeCircuitBroken(true)
    expect(isAutoModeActive()).toBe(true)
    expect(getAutoModeFlagCli()).toBe(true)
    expect(isAutoModeCircuitBroken()).toBe(true)
  })

  test('all three can be set/unset independently', () => {
    setAutoModeActive(true)
    setAutoModeFlagCli(true)
    setAutoModeCircuitBroken(true)
    // Unset only active.
    setAutoModeActive(false)
    expect(isAutoModeActive()).toBe(false)
    expect(getAutoModeFlagCli()).toBe(true)
    expect(isAutoModeCircuitBroken()).toBe(true)
  })
})

describe('_resetForTesting', () => {
  test('clears all three flags', () => {
    setAutoModeActive(true)
    setAutoModeFlagCli(true)
    setAutoModeCircuitBroken(true)
    _resetForTesting()
    expect(isAutoModeActive()).toBe(false)
    expect(getAutoModeFlagCli()).toBe(false)
    expect(isAutoModeCircuitBroken()).toBe(false)
  })

  test('idempotent — calling reset twice does not throw', () => {
    _resetForTesting()
    expect(() => _resetForTesting()).not.toThrow()
    expect(isAutoModeActive()).toBe(false)
  })
})
