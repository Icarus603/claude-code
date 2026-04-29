import { describe, expect, mock, test } from 'bun:test'
import { createFallbackStorage } from '../secureStorage/fallbackStorage.js'

type Storage = Parameters<typeof createFallbackStorage>[0]

function makeStorage(name: string, initial: Record<string, unknown> | null = null): Storage {
  let data: Record<string, unknown> | null = initial
  return {
    name,
    read: () => data,
    readAsync: async () => data,
    update: mock((newData: Record<string, unknown>) => {
      data = newData
      return { success: true }
    }) as never,
    delete: mock(() => {
      const had = data !== null
      data = null
      return had
    }) as never,
  } as Storage
}

describe('createFallbackStorage — name composition', () => {
  test('combines names with "-with-" + "-fallback" suffix', () => {
    const p = makeStorage('keychain')
    const s = makeStorage('plaintext')
    const fb = createFallbackStorage(p, s)
    expect(fb.name).toBe('keychain-with-plaintext-fallback')
  })
})

describe('read() — sync', () => {
  test('returns primary data when primary has data', () => {
    const p = makeStorage('p', { token: 'primary-data' })
    const s = makeStorage('s', { token: 'secondary-data' })
    const fb = createFallbackStorage(p, s)
    expect(fb.read()).toEqual({ token: 'primary-data' })
  })

  test('falls back to secondary when primary is null', () => {
    const p = makeStorage('p', null)
    const s = makeStorage('s', { token: 'secondary' })
    const fb = createFallbackStorage(p, s)
    expect(fb.read()).toEqual({ token: 'secondary' })
  })

  test('returns {} when both primary and secondary are null', () => {
    // Critical contract: read() never returns null — it returns {} as
    // the empty-storage sentinel. Catches refactors that change this.
    const p = makeStorage('p', null)
    const s = makeStorage('s', null)
    const fb = createFallbackStorage(p, s)
    expect(fb.read()).toEqual({})
  })

  test('primary undefined treated same as null', () => {
    const p = { ...makeStorage('p'), read: () => undefined } as Storage
    const s = makeStorage('s', { token: 'secondary' })
    const fb = createFallbackStorage(p, s)
    expect(fb.read()).toEqual({ token: 'secondary' })
  })
})

describe('readAsync() — async', () => {
  test('mirrors sync read for primary', async () => {
    const p = makeStorage('p', { token: 'primary' })
    const s = makeStorage('s', { token: 'secondary' })
    const fb = createFallbackStorage(p, s)
    expect(await fb.readAsync()).toEqual({ token: 'primary' })
  })

  test('falls back to secondary when primary returns null', async () => {
    const p = makeStorage('p', null)
    const s = makeStorage('s', { token: 'secondary' })
    const fb = createFallbackStorage(p, s)
    expect(await fb.readAsync()).toEqual({ token: 'secondary' })
  })

  test('returns {} when both null', async () => {
    const p = makeStorage('p', null)
    const s = makeStorage('s', null)
    const fb = createFallbackStorage(p, s)
    expect(await fb.readAsync()).toEqual({})
  })
})

describe('update() — primary success path', () => {
  test('writes to primary when primary update succeeds', () => {
    const p = makeStorage('p')
    const s = makeStorage('s')
    const fb = createFallbackStorage(p, s)
    const result = fb.update({ token: 'fresh' })
    expect(result.success).toBe(true)
    expect(p.read()).toEqual({ token: 'fresh' })
  })

  test('does NOT touch secondary when primary already has data', () => {
    const p = makeStorage('p', { token: 'old' })
    const s = makeStorage('s', { token: 'secondary' })
    const fb = createFallbackStorage(p, s)
    fb.update({ token: 'new' })
    // Secondary should still have its old value (no migrate-clear).
    expect(s.read()).toEqual({ token: 'secondary' })
  })

  test('CRITICAL — migrating from secondary to primary for the first time deletes secondary (#1414)', () => {
    // Scenario: container shares .claude with host. Host writes to plaintext
    // (secondary). Container starts up — wants to migrate to keychain
    // (primary). On first successful primary write, secondary is wiped to
    // avoid stale duplicate state.
    const p = makeStorage('p', null) // primary empty (first time)
    const s = makeStorage('s', { token: 'old-from-host' })
    const fb = createFallbackStorage(p, s)
    fb.update({ token: 'fresh' })
    expect(p.read()).toEqual({ token: 'fresh' })
    // Migration: secondary deleted.
    expect(s.read()).toBeNull()
  })
})

describe('update() — primary fallback path', () => {
  // When primary write fails (e.g., keychain locked), fall through to
  // secondary AND clean stale primary entry to avoid /login loop (#30337).

  test('writes to secondary when primary update fails', () => {
    const p = makeStorage('p')
    p.update = mock(() => ({ success: false })) as never
    const s = makeStorage('s')
    const fb = createFallbackStorage(p, s)
    const result = fb.update({ token: 'fresh' })
    expect(result.success).toBe(true)
    expect(s.read()).toEqual({ token: 'fresh' })
  })

  test('CRITICAL — when primary fails AND primary had stale data, primary is deleted (#30337)', () => {
    // Scenario: server rotated refresh token. New token written to primary
    // fails (e.g., keychain busy). We write to secondary. But primary still
    // holds the OLD token. read() prefers primary, so stale token shadows
    // fresh secondary data → user gets /login loop.
    // Fix: primary.delete() when fallback succeeds AND primary had data.
    let primaryData: Record<string, unknown> | null = { token: 'STALE-old' }
    const p = {
      name: 'p',
      read: () => primaryData,
      readAsync: async () => primaryData,
      update: mock(() => ({ success: false })) as never,
      delete: mock(() => {
        const had = primaryData !== null
        primaryData = null
        return had
      }) as never,
    } as Storage

    const s = makeStorage('s')
    const fb = createFallbackStorage(p, s)
    fb.update({ token: 'fresh' })
    // Primary was deleted to clear the stale entry.
    expect(p.delete).toHaveBeenCalled()
    expect(primaryData).toBeNull()
    // Secondary has fresh data.
    expect(s.read()).toEqual({ token: 'fresh' })
  })

  test('when primary fails AND primary had NO data, primary.delete is NOT called', () => {
    // Optimization: avoid noise/log spam when primary was already empty.
    const p = makeStorage('p', null)
    p.update = mock(() => ({ success: false })) as never
    p.delete = mock(() => false) as never
    const s = makeStorage('s')
    const fb = createFallbackStorage(p, s)
    fb.update({ token: 'fresh' })
    expect(p.delete).not.toHaveBeenCalled()
  })

  test('when both primary AND secondary fail, returns {success: false}', () => {
    const p = makeStorage('p')
    p.update = mock(() => ({ success: false })) as never
    const s = makeStorage('s')
    s.update = mock(() => ({ success: false })) as never
    const fb = createFallbackStorage(p, s)
    expect(fb.update({ token: 'fresh' })).toEqual({ success: false })
  })

  test('preserves warning from secondary when primary failed', () => {
    const p = makeStorage('p')
    p.update = mock(() => ({ success: false })) as never
    const s = makeStorage('s')
    s.update = mock(() => ({ success: true, warning: 'using plaintext' })) as never
    const fb = createFallbackStorage(p, s)
    expect(fb.update({ token: 'fresh' })).toEqual({
      success: true,
      warning: 'using plaintext',
    })
  })
})

describe('delete()', () => {
  test('deletes from BOTH primary and secondary', () => {
    const p = makeStorage('p', { token: 'p' })
    const s = makeStorage('s', { token: 's' })
    const fb = createFallbackStorage(p, s)
    fb.delete()
    expect(p.read()).toBeNull()
    expect(s.read()).toBeNull()
  })

  test('returns true when at least one had data', () => {
    const p = makeStorage('p', { token: 'p' })
    const s = makeStorage('s', null)
    const fb = createFallbackStorage(p, s)
    expect(fb.delete()).toBe(true)
  })

  test('returns true when only secondary had data', () => {
    const p = makeStorage('p', null)
    const s = makeStorage('s', { token: 's' })
    const fb = createFallbackStorage(p, s)
    expect(fb.delete()).toBe(true)
  })

  test('returns false when both were already empty', () => {
    const p = makeStorage('p', null)
    const s = makeStorage('s', null)
    const fb = createFallbackStorage(p, s)
    expect(fb.delete()).toBe(false)
  })

  test('always calls BOTH delete() methods (no short-circuit)', () => {
    const p = makeStorage('p', { token: 'p' })
    const s = makeStorage('s', { token: 's' })
    const fb = createFallbackStorage(p, s)
    fb.delete()
    expect(p.delete).toHaveBeenCalledTimes(1)
    expect(s.delete).toHaveBeenCalledTimes(1)
  })
})
