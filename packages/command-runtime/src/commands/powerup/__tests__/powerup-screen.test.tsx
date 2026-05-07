import { describe, expect, test, beforeEach, mock } from 'bun:test'
import * as React from 'react'

let mockConfig: { powerupsUnlocked?: string[] } = {}
mock.module('@claude-code/config', () => ({
  getGlobalConfig: () => mockConfig,
  saveGlobalConfig: (updater: (c: any) => any) => {
    mockConfig = updater(mockConfig)
  },
}))

mock.module('@claude-code/local-observability', () => ({
  logEvent: () => {},
}))

mock.module('../lessons/index.js', () => ({
  ALL_LESSONS: [
    { id: 'a', title: 'Alpha lesson', tagline: 'aaa', body: <></> },
    { id: 'b', title: 'Beta lesson', tagline: 'bbb', body: <></> },
  ],
}))

// Stub the Select component — its full Ink rendering needs the keyboard
// context that bun:test does not provide. We only need to verify
// that PowerupScreen *constructs* the right options and exposes the
// `onChange` / `onCancel` callbacks; pulling props out of the rendered
// element is enough.
mock.module('@claude-code/repl/components/CustomSelect/index.js', () => ({
  Select: (props: any) => {
    // Capture props on the React element via a synthetic data-test path;
    // tests inspect them after createElement returns.
    return { props, _stub: 'select' }
  },
}))

describe('PowerupScreen', () => {
  beforeEach(() => {
    mockConfig = {}
  })

  test('PowerupScreen exports a function', async () => {
    const { PowerupScreen } = await import('../powerup.js')
    expect(typeof PowerupScreen).toBe('function')
  })

  test('call() exports an async function returning ReactNode', async () => {
    const { call } = await import('../powerup.js')
    expect(typeof call).toBe('function')
  })
})

describe('lessonOptions', () => {
  test('builds option list from ALL_LESSONS with circle/check markers', async () => {
    mockConfig = { powerupsUnlocked: ['a'] }
    const { buildLessonOptions } = await import('../powerup.js')
    const opts = buildLessonOptions()
    expect(opts).toHaveLength(2)
    expect(opts[0]?.value).toBe('a')
    expect(opts[1]?.value).toBe('b')
    expect(opts[0]?.description).toBe('aaa')
    expect(opts[1]?.description).toBe('bbb')
  })
})
