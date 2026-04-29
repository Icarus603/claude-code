import { afterEach, describe, expect, test } from 'bun:test'
import {
  canYankPop,
  clearKillRing,
  getKillRingItem,
  getKillRingSize,
  getLastKill,
  pushToKillRing,
  recordYank,
  resetKillAccumulation,
  updateYankLength,
  yankPop,
} from '../Cursor.js'

afterEach(() => {
  clearKillRing()
  resetKillAccumulation()
})

describe('kill ring', () => {
  test('pushToKillRing stores text', () => {
    pushToKillRing('hello')
    expect(getLastKill()).toBe('hello')
    expect(getKillRingSize()).toBe(1)
  })

  test('consecutive kills accumulate', () => {
    pushToKillRing('hello ')
    pushToKillRing('world')
    expect(getLastKill()).toBe('hello world')
    expect(getKillRingSize()).toBe(1)
  })

  test('prepend direction inserts at front of accumulated kill', () => {
    pushToKillRing('world')
    pushToKillRing('hello ', 'prepend')
    expect(getLastKill()).toBe('hello world')
  })

  test('resetKillAccumulation breaks the chain', () => {
    pushToKillRing('first')
    resetKillAccumulation()
    pushToKillRing('second')
    expect(getLastKill()).toBe('second')
    expect(getKillRingSize()).toBe(2)
    expect(getKillRingItem(1)).toBe('first')
  })

  test('empty text is ignored', () => {
    pushToKillRing('')
    expect(getKillRingSize()).toBe(0)
  })

  test('ring caps at MAX_SIZE 10 — older entries fall off', () => {
    for (let i = 0; i < 15; i++) {
      pushToKillRing(`kill-${i}`)
      resetKillAccumulation()
    }
    expect(getKillRingSize()).toBe(10)
    expect(getLastKill()).toBe('kill-14')
    // Oldest retained is kill-5 (since 0..4 fell off)
    expect(getKillRingItem(9)).toBe('kill-5')
  })

  test('getKillRingItem normalizes negative + out-of-range indices', () => {
    pushToKillRing('a')
    resetKillAccumulation()
    pushToKillRing('b')
    resetKillAccumulation()
    pushToKillRing('c')
    // Most recent is 'c', then 'b', then 'a'
    expect(getKillRingItem(0)).toBe('c')
    expect(getKillRingItem(1)).toBe('b')
    expect(getKillRingItem(2)).toBe('a')
    // wraps around
    expect(getKillRingItem(3)).toBe('c')
    // negative wraps too
    expect(getKillRingItem(-1)).toBe('a')
  })

  test('clearKillRing empties everything', () => {
    pushToKillRing('a')
    resetKillAccumulation()
    pushToKillRing('b')
    clearKillRing()
    expect(getKillRingSize()).toBe(0)
    expect(getLastKill()).toBe('')
  })
})

describe('yank tracking', () => {
  test('canYankPop is false until a yank is recorded', () => {
    pushToKillRing('a')
    resetKillAccumulation()
    pushToKillRing('b')
    expect(canYankPop()).toBe(false)
  })

  test('canYankPop becomes true after recordYank', () => {
    pushToKillRing('a')
    resetKillAccumulation()
    pushToKillRing('b')
    recordYank(0, 1)
    expect(canYankPop()).toBe(true)
  })

  test('canYankPop is false when ring has only one entry', () => {
    pushToKillRing('a')
    recordYank(0, 1)
    expect(canYankPop()).toBe(false)
  })

  test('yankPop returns previous entries and tracks position', () => {
    pushToKillRing('a')
    resetKillAccumulation()
    pushToKillRing('b')
    resetKillAccumulation()
    pushToKillRing('c')
    recordYank(0, 1)
    const popped1 = yankPop()
    expect(popped1.text).toBe('b')
    const popped2 = yankPop()
    expect(popped2.text).toBe('a')
  })

  test('updateYankLength affects subsequent yankPop replacement range', () => {
    pushToKillRing('aa')
    resetKillAccumulation()
    pushToKillRing('bbbb')
    recordYank(5, 2)
    updateYankLength(4) // simulate yank insertion of 'bbbb'
    const popped = yankPop()
    // length-replacement window now covers the 4 we typed
    expect(popped.start).toBe(5)
    expect(popped.length).toBe(4)
  })

  test('pushing a new kill clears yank state', () => {
    pushToKillRing('a')
    resetKillAccumulation()
    pushToKillRing('b')
    recordYank(0, 1)
    expect(canYankPop()).toBe(true)
    pushToKillRing('c')
    expect(canYankPop()).toBe(false)
  })
})
