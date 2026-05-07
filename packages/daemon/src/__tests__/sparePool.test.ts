import { afterEach, describe, expect, test } from 'bun:test'
import {
  _resetSparePoolForTest,
  claimSpare,
  clearSpare,
  enableSparePool,
  isSparePoolEnabled,
  recordSpareSpawn,
} from '../sparePool.js'

afterEach(() => _resetSparePoolForTest())

describe('sparePool gate', () => {
  test('disabled by default', () => {
    expect(isSparePoolEnabled()).toBe(false)
  })

  test('enableSparePool flips the gate', () => {
    enableSparePool()
    expect(isSparePoolEnabled()).toBe(true)
  })

  test('enableSparePool is idempotent', () => {
    enableSparePool()
    enableSparePool()
    expect(isSparePoolEnabled()).toBe(true)
  })
})

describe('claimSpare', () => {
  test('returns no-spare when disabled', () => {
    const r = claimSpare('/cwd')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no-spare')
  })

  test('returns no-spare when enabled but slot empty', () => {
    enableSparePool()
    const r = claimSpare('/cwd')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no-spare')
  })

  test('returns cwd-mismatch when spare cwd differs', () => {
    enableSparePool()
    recordSpareSpawn('abc12345', '/spare/cwd')
    const r = claimSpare('/wrong/cwd')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('cwd-mismatch')
  })

  test('returns worker-side-not-wired even on cwd match (scaffolding only)', () => {
    enableSparePool()
    recordSpareSpawn('abc12345', '/cwd')
    const r = claimSpare('/cwd')
    // TODO: change to expect ok:true once worker-side claim msg is wired.
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('worker-side-not-wired')
  })
})

describe('recordSpareSpawn', () => {
  test('returns false when disabled', () => {
    expect(recordSpareSpawn('a', '/c')).toBe(false)
  })

  test('returns true on first record when enabled', () => {
    enableSparePool()
    expect(recordSpareSpawn('a', '/c')).toBe(true)
  })

  test('returns false on second record (single-slot)', () => {
    enableSparePool()
    recordSpareSpawn('a', '/c')
    expect(recordSpareSpawn('b', '/c')).toBe(false)
  })

  test('clearSpare frees the slot for next spawn', () => {
    enableSparePool()
    recordSpareSpawn('a', '/c')
    clearSpare()
    expect(recordSpareSpawn('b', '/c')).toBe(true)
  })
})
