/**
 * Contract: a background worker (CLAUDE_CODE_SESSION_KIND === 'bg') is ALWAYS
 * fullscreen, ahead of every opt-out.
 *
 * WHY THIS EXISTS — the FleetView→attach overlap bug (torn input-box borders,
 * overlapping rows, the cursor drifting below the footer when attaching to a
 * bg session). Root cause: the attach pipeline (attachClient.ts alt-screen
 * handoff + FRAME_CLEAR/home-erase boundary + BSU/ESU sync wrap) and the inner
 * Ink's full-repaint-on-resize (resetFramesForAltScreen) only work when the bg
 * worker renders in ALT-SCREEN. A main-screen worker uses differential
 * rendering (log-update tracks prev line count + relative cursor parking), so
 * after the attach client replays the ring + jiggles the pty, the worker's
 * relative cursor moves land at the wrong row → corruption.
 *
 * ant forces this unconditionally in `j9` (2.1.150 2218.js:53:
 * `if (SESSION_KIND === "bg") return true`) BEFORE its own NO_FLICKER check.
 * ant's bg worker is therefore always fullscreen, which is why ant never hit
 * this. ccb previously defaulted fullscreen on only for `USER_TYPE === 'ant'`,
 * so a non-ant operator's bg worker rendered on the main screen.
 *
 * The bg branch must sit ABOVE the NO_FLICKER opt-out: a bg worker with
 * NO_FLICKER=0 is a contradiction (it cannot be attached cleanly without
 * alt-screen), so bg wins. These assertions lock that ordering.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// getInitialSettings() reads config host bindings that aren't installed in a
// unit-test process. The bg-forced branch short-circuits BEFORE that call, so
// those cases never touch settings — but the non-bg ordering guards fall
// through to it. Stub tui=undefined (no persisted /tui choice) so they reach
// the auto-detect path. mock.module is global across the run; spread the real
// module first so other exports stay intact.
const realSettings = await import('@claude-code/config/settings')
mock.module('@claude-code/config/settings', () => ({
  ...realSettings,
  getInitialSettings: () => ({ tui: undefined }),
}))

const {
  isFullscreenEnvEnabled,
  _resetTmuxControlModeProbeForTesting,
} = await import('../fullscreen.js')

describe('isFullscreenEnvEnabled — bg worker forced fullscreen', () => {
  const saved: Record<string, string | undefined> = {}
  const ENV_KEYS = [
    'CLAUDE_CODE_SESSION_KIND',
    'CLAUDE_CODE_NO_FLICKER',
    'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN',
    'USER_TYPE',
    'TMUX',
    'TERM_PROGRAM',
  ] as const

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k]
    for (const k of ENV_KEYS) delete process.env[k]
    _resetTmuxControlModeProbeForTesting()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    _resetTmuxControlModeProbeForTesting()
  })

  test('bg session → fullscreen even when NO_FLICKER=0 opt-out is set', () => {
    // The exact corruption scenario: a non-ant operator (no USER_TYPE) attaches
    // to a bg worker. The bg branch must win over the explicit opt-out.
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_CODE_NO_FLICKER = '0'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('bg session → fullscreen for non-ant operator (no USER_TYPE)', () => {
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('bg session → fullscreen even under tmux -CC (which disables it otherwise)', () => {
    // tmux -CC would normally force fullscreen OFF; the bg short-circuit is
    // above that check, so a bg worker stays fullscreen regardless.
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    process.env.TERM_PROGRAM = 'iTerm.app'
    process.env.TERM = 'xterm-256color'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('non-bg + NO_FLICKER=0 → off (opt-out still honored for foreground)', () => {
    // Guard the ordering from the other side: the bg branch must NOT swallow
    // the foreground opt-out path.
    process.env.CLAUDE_CODE_NO_FLICKER = '0'
    expect(isFullscreenEnvEnabled()).toBe(false)
  })

  test('non-bg, non-ant, no env → off (unchanged default)', () => {
    expect(isFullscreenEnvEnabled()).toBe(false)
  })
})
