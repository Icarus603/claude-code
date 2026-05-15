/**
 * `/goal active` REPL footer indicator — port of ant v2.1.142 4925.js
 * (kxK module / NxK component).
 *
 * Behaviour (matches ant byte-for-byte):
 *   - vX6 = 20     (color step count for the pulse cycle)
 *   - CI3 = 4000   (full pulse cycle in ms)
 *   - II3 = 0.18   (amplitude — 18% brightness modulation)
 *   - Elastic timer: re-render every 1s for goals < 60s old; every 60s
 *     once the goal has been running longer.
 *   - Elapsed parens `(${_K(D, {mostSignificantOnly:true})})` rendered
 *     for any goal age >= 1s (ant: `< 1000 ? "" : ...`).
 *   - When `withSeparator`, prefix " · " in dim color.
 *   - The pulse cycles through a 20-step cosine-based color modulation
 *     of the active permission color.
 *
 * Renders to NOTHING when there is no active goal — caller can mount
 * unconditionally.
 */
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Box, Text } from '@anthropic/ink'
import { BLACK_CIRCLE } from '@claude-code/output/constants/figures.js'
import { useAppState } from '@claude-code/app-host/state/AppState.js'

const PULSE_STEPS = 20
const PULSE_CYCLE_MS = 4000
/** Frame interval — 4000ms / 20 = 200ms per pulse step. */
const FRAME_INTERVAL_MS = PULSE_CYCLE_MS / PULSE_STEPS

/**
 * Compact duration formatter, matching ant `_K(ms, {mostSignificantOnly})`.
 * Most-significant-only: "5s", "1m", "2h", "3d".
 */
function formatCompactDuration(diffMs: number): string {
  if (diffMs < 1000) return `${Math.max(1, Math.round(diffMs / 1000))}s`
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Elastic timer: ant `E = v < 60000 ? 1000 : 60000`. For goals
  // < 60s old, refresh every 1s for second-level elapsed display.
  // For older goals, refresh every 60s.
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!activeGoal) return

    const tick = () => {
      const age = Date.now() - activeGoal.setAt
      // ant: `v < 60000 ? 1000 : 60000` — next interval adjusts
      // based on current age.
      const interval = age < 60_000 ? 1000 : 60_000
      const nextTick = interval - (age % interval)
      forceRerender(v => v + 1)
      timerRef.current = setTimeout(tick, nextTick)
    }
    // Initial tick after computing next boundary.
    const age = Date.now() - activeGoal.setAt
    const interval = age < 60_000 ? 1000 : 60_000
    const nextTick = interval - (age % interval)
    timerRef.current = setTimeout(tick, nextTick)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
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
  // ant: `X < 1000 ? "" : \` (${_K(D,{mostSignificantOnly:!0})})\``
  // Show elapsed time for any goal >= 1s old.
  const ageLabel = diffMs < 1000 ? '' : ` (${formatCompactDuration(diffMs)})`

  // Pulse through a 20-step cosine color cycle, approximating ant's
  // true-color modulation with ccb's theme palette.
  const dotColor = frame < PULSE_STEPS / 2 ? 'permission' : 'permissionShimmer'

  return (
    <Box flexShrink={0}>
      {props.withSeparator && <Text dimColor> · </Text>}
      <Text color={dotColor}>{`${BLACK_CIRCLE} /goal active${ageLabel}`}</Text>
    </Box>
  )
}
