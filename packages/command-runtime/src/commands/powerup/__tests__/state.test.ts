import { describe, expect, test, beforeEach, mock } from 'bun:test'

// Inline-mock pattern: mock.module is GLOBAL across the run, so we keep state per test.
let mockConfig: { powerupsUnlocked?: string[] } = {}
mock.module('@claude-code/config', () => ({
  getGlobalConfig: () => mockConfig,
  saveGlobalConfig: (updater: (c: any) => any) => {
    mockConfig = updater(mockConfig)
  },
}))

mock.module('../lessons/index.js', () => ({
  ALL_LESSONS: [
    { id: 'lesson-a', title: 'A', tagline: 'a', body: null },
    { id: 'lesson-b', title: 'B', tagline: 'b', body: null },
    { id: 'lesson-c', title: 'C', tagline: 'c', body: null },
  ],
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
    const { markUnlocked, getUnlocked } = await import('../state.js')
    markUnlocked('lesson-a')
    expect(getUnlocked().has('lesson-a')).toBe(true)
    expect(mockConfig.powerupsUnlocked).toEqual(['lesson-a'])
  })

  test('markUnlocked is idempotent', async () => {
    const { markUnlocked, getUnlocked } = await import('../state.js')
    markUnlocked('lesson-a')
    markUnlocked('lesson-a')
    expect(getUnlocked().size).toBe(1)
  })

  test('getUnlocked filters out stale ids not in ALL_LESSONS', async () => {
    mockConfig = { powerupsUnlocked: ['lesson-a', 'removed-old-lesson'] }
    const { getUnlocked } = await import('../state.js')
    const u = getUnlocked()
    expect(u.has('lesson-a')).toBe(true)
    expect(u.has('removed-old-lesson')).toBe(false)
    expect(u.size).toBe(1)
  })

  test('isAllUnlocked is true only when all known lessons are unlocked', async () => {
    const { markUnlocked, isAllUnlocked } = await import('../state.js')
    expect(isAllUnlocked()).toBe(false)
    markUnlocked('lesson-a')
    markUnlocked('lesson-b')
    expect(isAllUnlocked()).toBe(false)
    markUnlocked('lesson-c')
    expect(isAllUnlocked()).toBe(true)
  })
})
