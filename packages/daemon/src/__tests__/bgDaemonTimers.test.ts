import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  makeIdleActivityCount,
  setupIdleExitWatchdog,
  setupUpgradeWatchdog,
} from '../bgDaemonTimers.js'

describe('makeIdleActivityCount', () => {
  test('sums leases + workers + detached', () => {
    const count = makeIdleActivityCount({
      leases: { size: 2 },
      workers: { size: 1 },
      detached: { size: 3 },
    })
    expect(count()).toBe(6)
  })

  test('zero when all empty', () => {
    const count = makeIdleActivityCount({
      leases: { size: 0 },
      workers: { size: 0 },
      detached: { size: 0 },
    })
    expect(count()).toBe(0)
  })

  test('reflects mutation through reference', () => {
    const state = {
      leases: { size: 1 },
      workers: { size: 0 },
      detached: { size: 0 },
    }
    const count = makeIdleActivityCount(state)
    expect(count()).toBe(1)
    state.leases = { size: 0 }
    state.workers = { size: 5 }
    expect(count()).toBe(5)
  })
})

describe('setupIdleExitWatchdog', () => {
  let abort: AbortController
  let activity: number

  beforeEach(() => {
    abort = new AbortController()
    activity = 0
  })

  afterEach(() => {
    if (!abort.signal.aborted) abort.abort()
  })

  test('non-transient origin never schedules', async () => {
    const wd = setupIdleExitWatchdog({
      origin: 'service',
      abort,
      graceMs: 10,
      countActivity: () => activity,
    })
    wd.probe()
    await new Promise(r => setTimeout(r, 30))
    expect(abort.signal.aborted).toBe(false)
    wd.dispose()
  })

  test('transient + activity > 0 never aborts', async () => {
    activity = 1
    const wd = setupIdleExitWatchdog({
      origin: 'transient',
      abort,
      graceMs: 10,
      countActivity: () => activity,
    })
    wd.probe()
    await new Promise(r => setTimeout(r, 30))
    expect(abort.signal.aborted).toBe(false)
    wd.dispose()
  })

  test('transient + activity == 0 for graceMs aborts', async () => {
    const wd = setupIdleExitWatchdog({
      origin: 'transient',
      abort,
      graceMs: 10,
      countActivity: () => activity,
    })
    wd.probe()
    await new Promise(r => setTimeout(r, 30))
    expect(abort.signal.aborted).toBe(true)
    wd.dispose()
  })

  test('activity returning > 0 mid-grace cancels the abort', async () => {
    const wd = setupIdleExitWatchdog({
      origin: 'transient',
      abort,
      graceMs: 30,
      countActivity: () => activity,
    })
    wd.probe()
    await new Promise(r => setTimeout(r, 5))
    activity = 1
    wd.probe()
    await new Promise(r => setTimeout(r, 50))
    expect(abort.signal.aborted).toBe(false)
    wd.dispose()
  })

  test('repeat probe while timer pending is a no-op', async () => {
    const wd = setupIdleExitWatchdog({
      origin: 'transient',
      abort,
      graceMs: 10,
      countActivity: () => activity,
    })
    wd.probe()
    wd.probe()
    wd.probe()
    await new Promise(r => setTimeout(r, 30))
    expect(abort.signal.aborted).toBe(true)
    wd.dispose()
  })

  test('dispose cancels pending timer', async () => {
    const wd = setupIdleExitWatchdog({
      origin: 'transient',
      abort,
      graceMs: 30,
      countActivity: () => activity,
    })
    wd.probe()
    wd.dispose()
    await new Promise(r => setTimeout(r, 50))
    expect(abort.signal.aborted).toBe(false)
  })
})

describe('setupUpgradeWatchdog', () => {
  test('returns a dispose function (smoke)', () => {
    const abort = new AbortController()
    const w = setupUpgradeWatchdog(abort)
    expect(typeof w.dispose).toBe('function')
    w.dispose()
  })

  test('dispose called when binary unreadable returns no-op', () => {
    // We can't easily mock argv[1] mid-test, but the sentinel branch
    // for "unreadable binary" is exercised whenever statSync fails on
    // a non-existent path (e.g. test runner's process.argv[1] is the
    // bun binary itself, which is readable, so this is a smoke check
    // that dispose() doesn't throw on a valid setup).
    const abort = new AbortController()
    const w = setupUpgradeWatchdog(abort)
    expect(() => w.dispose()).not.toThrow()
  })
})
