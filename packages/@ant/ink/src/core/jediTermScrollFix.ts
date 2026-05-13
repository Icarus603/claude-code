/**
 * JetBrains JediTerm scroll-bug workaround — ported from ant v2.1.132 Z2H
 * (2244.js).
 *
 * IntelliJ's integrated terminal (when "Command Blocks" mode is enabled
 * via `INTELLIJ_TERMINAL_COMMAND_BLOCKS_REWORKED=1`) sometimes flips a
 * wheel-down into a wheel-up event right after a real wheel-down. The
 * fix: if a wheelup arrives within `WHEELUP_AFTER_DOWN_WINDOW_MS` of the
 * last wheeldown, force it back to wheeldown. We only enable the
 * workaround when we detect the IntelliJ env var so other terminals are
 * unaffected.
 *
 * Emits `tengu_jediterm_scroll_bug_detected` on first flip per session
 * so we can track how often the workaround actually fires.
 */
import { logEvent as obsLogEvent } from '@claude-code/local-observability'

// Telemetry wrapper — best-effort and optional so test/bootstrap paths
// that haven't installed the sink don't crash on a missing dep.
function logEvent(name: string, payload: Record<string, unknown>): void {
  try {
    obsLogEvent(name, payload)
  } catch {
    // telemetry sink unavailable (e.g. during bootstrap or in tests) — fine
  }
}

// 250ms — wheelup-after-wheeldown threshold. Matches ant xZ1.
const WHEELUP_AFTER_DOWN_WINDOW_MS = 250

export function isJediTermCommandBlocksEnv(): boolean {
  return (
    process.env.INTELLIJ_TERMINAL_COMMAND_BLOCKS_REWORKED === '1' ||
    process.env.INTELLIJ_TERMINAL_COMMAND_BLOCKS === '1'
  )
}

let lastWheelDownAt: number | null = null
let detectionFired = false

/**
 * Test-only — reset module state between tests.
 */
export function _resetForTesting(): void {
  lastWheelDownAt = null
  detectionFired = false
}

/**
 * Filter incoming mouse-wheel direction. Returns the corrected direction
 * the rest of the UI should use. Pass through unchanged when:
 *   - we're not in JediTerm command-blocks mode
 *   - the event is wheeldown
 *   - the previous wheeldown is too old (real user wheelup, not a flip)
 */
export function correctWheelDirection(
  direction: 'up' | 'down',
  nowMs: number = Date.now(),
): 'up' | 'down' {
  if (direction === 'down') {
    lastWheelDownAt = nowMs
    return 'down'
  }
  if (!isJediTermCommandBlocksEnv()) return 'up'
  if (
    lastWheelDownAt !== null &&
    nowMs - lastWheelDownAt < WHEELUP_AFTER_DOWN_WINDOW_MS
  ) {
    if (!detectionFired) {
      detectionFired = true
      logEvent('tengu_jediterm_scroll_bug_detected', {})
    }
    return 'down'
  }
  return 'up'
}
