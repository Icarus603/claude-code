/**
 * Animated row glyph — advances through the 12-frame ping-pong cycle at
 * 120 ms per frame. Source: ant Cs3 (5092.js:605-613).
 *
 * Wall-clock-driven (`Math.floor(now/120) % 12`) rather than counter-driven
 * so multiple FleetSpinner instances stay phase-synced regardless of mount
 * order — a visual win when a column of rows is all working at once.
 */

import { Text } from '@anthropic/ink'
import { useEffect, useState } from 'react'

import {
  SPINNER_FRAME_MS,
  getSpinnerFramesCycle,
} from '../helpers/spinnerFrames.js'

interface FleetSpinnerProps {
  /**
   * Color name passed straight to Ink `<Text color>`. Undefined renders
   * with the parent's color (typically dimmed).
   */
  color?: string
  /** If true, applies `dimColor` on the glyph text. */
  dim?: boolean
}

/** Source: ant Cs3. */
export function FleetSpinner({ color, dim }: FleetSpinnerProps): JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), SPINNER_FRAME_MS)
    return () => clearInterval(handle)
  }, [])
  const cycle = getSpinnerFramesCycle()
  const frame = cycle[Math.floor(now / SPINNER_FRAME_MS) % cycle.length]
  return (
    <Text color={color} dimColor={dim}>
      {frame}
    </Text>
  )
}
