/**
 * Contract: ccb's isFullscreenEnvEnabled is a 1:1 port of ant's `j9`
 * (2.1.150 2218.js:51-80). The decision tree, in order, and WHY:
 *
 * The alt-screen ("fullscreen") renderer is ant's blessed path. The main-screen
 * renderer (ant's /tui "classic") uses DIFFERENTIAL rendering whose diff loop
 * has an unfixed tear: when content overflows the viewport, a changed row above
 * the viewport-top threshold is silently skipped (ant 2344.js:129 `return;`),
 * so the input box border tears, the right half blanks, and the cursor drifts
 * below the footer. ant never fixed that — it ships all anti-tear engineering
 * on the alt-screen path only and rolls fullscreen out to everyone via the
 * GrowthBook gates tengu_pewter_brook / tengu_amber_creek. ant's `j9` has NO
 * `USER_TYPE === 'ant'` check; that was a ccb-only invention that locked
 * non-ant operators onto the legacy tearing renderer. ccb is solo-maintained
 * with no GrowthBook server, so the local default IS fullscreen (the rolled-out
 * state).
 *
 * These assertions lock the ordering so the gate can't silently regress back to
 * a default-off / identity-gated state.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// getInitialSettings() reads config host bindings that aren't installed in a
// unit-test process. Only the settings.tui branch touches it; stub tui=undefined
// (no persisted /tui choice) so the fall-through cases reach the default.
// mock.module is global across the run; spread the real module first so other
// exports stay intact.
const realSettings = await import('@claude-code/config/settings')
mock.module('@claude-code/config/settings', () => ({
  ...realSettings,
  getInitialSettings: () => ({ tui: undefined }),
}))

const {
  isFullscreenEnvEnabled,
  _resetTmuxControlModeProbeForTesting,
} = await import('../fullscreen.js')

describe('isFullscreenEnvEnabled — ant j9 parity', () => {
  const saved: Record<string, string | undefined> = {}
  const ENV_KEYS = [
    'CLAUDE_CODE_SESSION_KIND',
    'CLAUDE_CODE_NO_FLICKER',
    'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN',
    'USER_TYPE',
    'TMUX',
    'TERM_PROGRAM',
    'SSH_CONNECTION',
    'SSH_CLIENT',
    'SSH_TTY',
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

  // --- default (step 7): the regression that caused the tearing input box ---

  test('plain non-ant operator, no env, no settings → fullscreen (the fix)', () => {
    // This is the exact case that was broken: a non-ant Pro/Max user on macOS
    // with nothing set. Pre-fix this returned false (USER_TYPE !== 'ant') and
    // the operator was stuck on the tearing main-screen renderer.
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('USER_TYPE no longer gates the default (ant j9 has no such check)', () => {
    process.env.USER_TYPE = 'external'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  // --- step 1: bg worker forced fullscreen, ahead of every opt-out ---

  test('bg session → fullscreen even when NO_FLICKER=0 opt-out is set', () => {
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_CODE_NO_FLICKER = '0'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('bg session → fullscreen even under tmux -CC', () => {
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.TMUX = '/tmp/tmux-1000/default,1,0'
    process.env.TERM_PROGRAM = 'iTerm.app'
    process.env.TERM = 'xterm-256color'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  // --- step 2: explicit opt-out (ant V$8) ---

  test('NO_FLICKER=0 → off (explicit opt-out honored for foreground)', () => {
    process.env.CLAUDE_CODE_NO_FLICKER = '0'
    expect(isFullscreenEnvEnabled()).toBe(false)
  })

  test('DISABLE_ALTERNATE_SCREEN=1 → off (the V$8 arm ccb was missing)', () => {
    process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = '1'
    expect(isFullscreenEnvEnabled()).toBe(false)
  })

  // --- step 3: explicit opt-in ---

  test('NO_FLICKER=1 → fullscreen', () => {
    process.env.CLAUDE_CODE_NO_FLICKER = '1'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })
})
