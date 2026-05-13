/**
 * `/goal active` REPL footer indicator — port of ant v2.1.136 4917.js
 * (EyK module / CyK component).
 *
 * Mirrors ant byte-for-byte:
 *   - vX6 = 20     (color step count for the pulse cycle)
 *   - CI3 = 4000   (full pulse cycle in ms)
 *   - II3 = 0.18   (amplitude — 18% brightness modulation)
 *   - Re-render-elapsed timer only when activeGoal exists.
 *   - Elapsed parens "(${_K(D, {mostSignificantOnly:true})})" rendered
 *     ONLY when age ≥ 60s; for fresh goals there are no parens.
 *   - When `withSeparator`, prefix " · " in dim color.
 *   - The pulse cycles through a palette of brightness-modulated copies
 *     of the active permission color (ant uses true-color RGB; ccb
 *     approximates with two-tone since Ink can't emit truecolor escapes
 *     from a theme palette).
 *
 * Renders to NOTHING when there is no active goal — caller can mount
 * unconditionally.
 */
import * as React from 'react'
import { useEffect, useState } from 'react'
import { Box, Text } from '@anthropic/ink'
import { BLACK_CIRCLE } from '@claude-code/output/constants/figures.js'
import { useAppState } from '@claude-code/app-host/state/AppState.js'

const PULSE_STEPS = 20
const PULSE_CYCLE_MS = 4000
/** Frame interval — 4000ms / 20 = 200ms per pulse step. */
const FRAME_INTERVAL_MS = PULSE_CYCLE_MS / PULSE_STEPS
const RELATIVE_TIMER_MS = 60_000

/**
 * Compact duration formatter, matching ant `_K(ms, {mostSignificantOnly})`.
 * Most-significant-only: "1m", "2h", "3d".
 */
function formatCompactDuration(diffMs: number): string {
  if (diffMs < 60_000) return `${Math.max(1, Math.round(diffMs / 1000))}s`
  const totalMin = Math.round(diffMs / 60_000)
  if (totalMin < 60) return `${totalMin}m`
  const hours = Math.floor(totalMin / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function GoalActiveIndicator(props: {
  withSeparator?: boolean
}): React.ReactNode {
  const activeGoal = useAppState(state => state.activeGoal)
  const [, forceRerender] = useState(0)
  const [frame, setFrame] = useState(0)

  // Re-render elapsed-time label every 60s; only when active.
  useEffect(() => {
    if (!activeGoal) return
    const id = setInterval(() => forceRerender(v => v + 1), RELATIVE_TIMER_MS)
    return () => clearInterval(id)
  }, [activeGoal])

  // Advance pulse frame every FRAME_INTERVAL_MS while goal is active.
  useEffect(() => {
    if (!activeGoal) return
    const id = setInterval(
      () => setFrame(v => (v + 1) % PULSE_STEPS),
      FRAME_INTERVAL_MS,
    )
    return () => clearInterval(id)
  }, [activeGoal])

  if (!activeGoal) return null

  const diffMs = Date.now() - activeGoal.setAt
  // Ant: `D<60000?"":\` (${_K(D,{mostSignificantOnly:!0})})\`` — no
  // parens for fresh goals; otherwise " (5m)".
  const ageLabel = diffMs < 60_000 ? '' : ` (${formatCompactDuration(diffMs)})`

  // Ink theme exposes `permission` and `permissionShimmer` as the two
  // ends of the pulse spectrum. ant uses a 20-step true-color pulse;
  // we approximate by alternating the two themed tokens at the cycle
  // midpoint. Goal semantics are conveyed by the dot + label; the
  // pulse is decoration.
  const dotColor = frame < PULSE_STEPS / 2 ? 'permission' : 'permissionShimmer'

  return (
    <Box flexShrink={0}>
      {props.withSeparator && <Text dimColor> · </Text>}
      <Text color={dotColor}>{`${BLACK_CIRCLE} /goal active${ageLabel}`}</Text>
    </Box>
  )
}
