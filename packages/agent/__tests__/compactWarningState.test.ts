import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  clearCompactWarningSuppression,
  compactWarningStore,
  suppressCompactWarning,
} from '../compaction/compactWarningState.js'

beforeEach(() => {
  clearCompactWarningSuppression()
})

afterEach(() => {
  clearCompactWarningSuppression()
})

describe('compactWarningStore — initial state', () => {
  test('starts as false', () => {
    expect(compactWarningStore.getState()).toBe(false)
  })
})

describe('suppressCompactWarning / clearCompactWarningSuppression', () => {
  test('suppress sets state to true', () => {
    suppressCompactWarning()
    expect(compactWarningStore.getState()).toBe(true)
  })

  test('clear sets state back to false', () => {
    suppressCompactWarning()
    clearCompactWarningSuppression()
    expect(compactWarningStore.getState()).toBe(false)
  })

  test('repeated suppress is idempotent', () => {
    suppressCompactWarning()
    suppressCompactWarning()
    suppressCompactWarning()
    expect(compactWarningStore.getState()).toBe(true)
  })

  test('repeated clear is idempotent', () => {
    clearCompactWarningSuppression()
    clearCompactWarningSuppression()
    expect(compactWarningStore.getState()).toBe(false)
  })
})

describe('subscribe — listener notifications', () => {
  test('listener fires when state changes', () => {
    const listener = mock(() => {})
    const unsubscribe = compactWarningStore.subscribe(listener)
    suppressCompactWarning()
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  test('listener does NOT fire when state is set to the same value (Object.is check)', () => {
    // The store has a `Object.is(next, prev) → skip` guard. This avoids
    // unnecessary re-renders when an identical value is set.
    suppressCompactWarning() // false → true (would notify, but no listener yet)
    const listener = mock(() => {})
    const unsubscribe = compactWarningStore.subscribe(listener)
    suppressCompactWarning() // true → true (no change)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  test('multiple listeners all fire on state change', () => {
    const a = mock(() => {})
    const b = mock(() => {})
    const c = mock(() => {})
    const unsubA = compactWarningStore.subscribe(a)
    const unsubB = compactWarningStore.subscribe(b)
    const unsubC = compactWarningStore.subscribe(c)
    suppressCompactWarning()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    expect(c).toHaveBeenCalledTimes(1)
    unsubA()
    unsubB()
    unsubC()
  })

  test('unsubscribe stops a listener from receiving future notifications', () => {
    const listener = mock(() => {})
    const unsubscribe = compactWarningStore.subscribe(listener)
    suppressCompactWarning()
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    clearCompactWarningSuppression()
    expect(listener).toHaveBeenCalledTimes(1) // still 1
  })

  test('listener fires on both directions (suppress AND clear)', () => {
    const listener = mock(() => {})
    const unsubscribe = compactWarningStore.subscribe(listener)
    suppressCompactWarning() // false → true
    clearCompactWarningSuppression() // true → false
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  test('unsubscribing one listener does not affect others', () => {
    const a = mock(() => {})
    const b = mock(() => {})
    const unsubA = compactWarningStore.subscribe(a)
    const unsubB = compactWarningStore.subscribe(b)
    unsubA()
    suppressCompactWarning()
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    unsubB()
  })
})
