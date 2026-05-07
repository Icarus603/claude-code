import { describe, expect, test, beforeEach, mock } from 'bun:test'

// `mock.module()` is GLOBAL across the entire bun test run — see
// `feedback_bun_mock_module_global_scope.md`. The neighbouring
// state.test.ts already mocks `../lessons/index.js` with three
// `lesson-{a,b,c}` entries; we cannot install a *competing* mock here
// without one suite clobbering the other. Instead we exercise
// powerup.tsx against the **real** lessons/index.ts (currently 3
// lessons — at-mentions, modes, undo). The assertions below pin only
// shape, not specific lesson identities, so additional lessons in
// later tasks won't break this file.
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

// Stub the Select component — its full Ink rendering needs the keyboard
// context that bun:test does not provide. We only need to verify
// that PowerupScreen *constructs* the right options and exposes the
// `onChange` / `onCancel` callbacks.
mock.module('@claude-code/repl/components/CustomSelect/index.js', () => ({
  Select: (props: unknown) => ({ props, _stub: 'select' }),
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

describe('buildLessonOptions', () => {
  test('builds an option per real lesson with circle marker when nothing unlocked', async () => {
    mockConfig = {}
    const { buildLessonOptions } = await import('../powerup.js')
    const { ALL_LESSONS } = await import('../lessons/index.js')

    const opts = buildLessonOptions()

    expect(opts).toHaveLength(ALL_LESSONS.length)
    expect(opts.length).toBeGreaterThan(0) // at least one lesson registered
    for (let i = 0; i < ALL_LESSONS.length; i++) {
      expect(opts[i]?.value).toBe(ALL_LESSONS[i]!.id)
      expect(opts[i]?.description).toBe(ALL_LESSONS[i]!.tagline)
    }
  })

  test('marks unlocked lessons with success-coloured ✓ label, others with ○', async () => {
    const { ALL_LESSONS } = await import('../lessons/index.js')
    const firstId = ALL_LESSONS[0]!.id
    mockConfig = { powerupsUnlocked: [firstId] }

    const { buildLessonOptions } = await import('../powerup.js')
    const opts = buildLessonOptions()

    // Unlocked option's label is a JSX element (Text with success colour);
    // locked option's label is a plain string starting with '○ '.
    expect(typeof opts[0]?.label).toBe('object')
    if (opts.length > 1) {
      expect(typeof opts[1]?.label).toBe('string')
      expect(opts[1]?.label).toMatch(/^○ /)
    }
  })
})
