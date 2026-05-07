import { describe, expect, test, beforeEach, mock } from 'bun:test'

// `mock.module()` is GLOBAL across the entire bun test run. Mocking
// `../lessons/index.js` here would clobber other suites that import the
// real module (e.g. powerup-screen.test). Instead we test against the
// *real* ALL_LESSONS — at any given commit it has at least one entry,
// and the invariants below hold parametrically. As new lessons land
// (Tasks 10–16) this file does not need updating.
let mockConfig: { powerupsUnlocked?: string[] } = {}
// MOCK_FULL_REPLACE: state.test isolates GlobalConfig persistence — getGlobalConfig and saveGlobalConfig are the only surface used; full-replace avoids disk I/O.
mock.module('@claude-code/config', () => ({
  getGlobalConfig: () => mockConfig,
  saveGlobalConfig: (updater: (c: any) => any) => {
    mockConfig = updater(mockConfig)
  },
}))

describe('powerup state', () => {
  beforeEach(() => {
    mockConfig = {}
  })

  test('getUnlocked returns empty set when field is undefined', async () => {
    const { getUnlocked } = await import('../state.js')
    expect(getUnlocked().size).toBe(0)
  })

  test('markUnlocked persists the id', async () => {
    const { ALL_LESSONS } = await import('../lessons/index.js')
    const { markUnlocked, getUnlocked } = await import('../state.js')
    const id = ALL_LESSONS[0]!.id
    markUnlocked(id)
    expect(getUnlocked().has(id)).toBe(true)
    expect(mockConfig.powerupsUnlocked).toEqual([id])
  })

  test('markUnlocked is idempotent', async () => {
    const { ALL_LESSONS } = await import('../lessons/index.js')
    const { markUnlocked, getUnlocked } = await import('../state.js')
    const id = ALL_LESSONS[0]!.id
    markUnlocked(id)
    markUnlocked(id)
    expect(getUnlocked().size).toBe(1)
  })

  test('getUnlocked filters out stale ids not in ALL_LESSONS', async () => {
    const { ALL_LESSONS } = await import('../lessons/index.js')
    const realId = ALL_LESSONS[0]!.id
    mockConfig = { powerupsUnlocked: [realId, 'removed-old-lesson'] }
    const { getUnlocked } = await import('../state.js')
    const u = getUnlocked()
    expect(u.has(realId)).toBe(true)
    expect(u.has('removed-old-lesson')).toBe(false)
    expect(u.size).toBe(1)
  })

  test('isAllUnlocked is true only when every lesson is unlocked', async () => {
    const { ALL_LESSONS } = await import('../lessons/index.js')
    const { markUnlocked, isAllUnlocked } = await import('../state.js')

    // Empty start
    expect(isAllUnlocked()).toBe(false)

    // Unlock all but one — still not done
    if (ALL_LESSONS.length >= 2) {
      for (let i = 0; i < ALL_LESSONS.length - 1; i++) {
        markUnlocked(ALL_LESSONS[i]!.id)
      }
      expect(isAllUnlocked()).toBe(false)
    }

    // Unlock the last one — done
    markUnlocked(ALL_LESSONS[ALL_LESSONS.length - 1]!.id)
    expect(isAllUnlocked()).toBe(true)
  })

  test('totalLessons matches the live ALL_LESSONS length', async () => {
    const { ALL_LESSONS } = await import('../lessons/index.js')
    const { totalLessons } = await import('../state.js')
    expect(totalLessons()).toBe(ALL_LESSONS.length)
  })
})
