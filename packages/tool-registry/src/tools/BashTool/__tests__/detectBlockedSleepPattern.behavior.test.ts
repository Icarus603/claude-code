import { describe, expect, test } from 'bun:test'

import { detectBlockedSleepPattern } from '../BashTool.tsx'

/**
 * Pin the sleep-detection heuristic. The Bash tool blocks polls-via-sleep
 * because they're a common anti-pattern in long-running workflows (waiting
 * for builds, services, async results). The block triggers a model-side
 * reminder to use Monitor or to act event-driven instead.
 *
 * The heuristic must:
 *  - Block `sleep 5`, `sleep 60`, etc. (integer seconds ≥ 2)
 *  - Block `sleep 5 && check` (sleep-then-check polling pattern)
 *  - ALLOW `sleep 0.5` (sub-second pacing for rate limiting)
 *  - ALLOW `sleep 1` (1s — rate limiting, not polling)
 *  - ALLOW `something_else && sleep 5` (sleep after a real command)
 */
describe('detectBlockedSleepPattern (Bash tool poll-prevention)', () => {
  test('bare `sleep 5` → blocked (standalone wait)', () => {
    expect(detectBlockedSleepPattern('sleep 5')).toBe('standalone sleep 5')
  })

  test('`sleep 60 && check_done` → blocked with follow-up suggested', () => {
    // splitCommand strips the `&&` separator; rest just shows the second command.
    const result = detectBlockedSleepPattern('sleep 60 && check_done')
    expect(result).toBe('sleep 60 followed by: check_done')
  })

  test('`sleep 5; ls` (semicolon, not &&) → blocked too (poll-pattern)', () => {
    // splitCommand handles ; and && both as separators. Pin behavior so
    // a future refactor that only splits on && doesn't let the model
    // bypass the gate with a semicolon.
    const result = detectBlockedSleepPattern('sleep 5; ls')
    // The function returns whatever rest splitCommand produced, joined back
    expect(result).not.toBeNull()
    expect(result).toContain('sleep 5')
  })

  test('`sleep 1` → allowed (1s pacing, not polling)', () => {
    expect(detectBlockedSleepPattern('sleep 1')).toBeNull()
  })

  test('`sleep 0.5` → allowed (sub-second, definitely pacing)', () => {
    // The regex /^sleep\s+(\d+)\s*$/ requires integer, so float fails the
    // pattern match and returns null naturally.
    expect(detectBlockedSleepPattern('sleep 0.5')).toBeNull()
  })

  test('`ls && sleep 5` → allowed (sleep follows a real command, not vice versa)', () => {
    // The function only checks if the FIRST subcommand is `sleep N`.
    // sleep-as-post-step is fine; sleep-as-first-step is the poll pattern.
    expect(detectBlockedSleepPattern('ls && sleep 5')).toBeNull()
  })

  test('`sleep` alone (no duration) → allowed (will error at shell, not our concern)', () => {
    expect(detectBlockedSleepPattern('sleep')).toBeNull()
  })

  test('empty command → null (no crash)', () => {
    expect(detectBlockedSleepPattern('')).toBeNull()
  })

  test('`sleep 2` → blocked (right at the threshold)', () => {
    // The cutoff is `< 2` returns null, so 2 itself triggers the block.
    expect(detectBlockedSleepPattern('sleep 2')).toBe('standalone sleep 2')
  })

  test('whitespace around `sleep N` → still blocked', () => {
    expect(detectBlockedSleepPattern('sleep 5  ')).toBe('standalone sleep 5')
  })
})
