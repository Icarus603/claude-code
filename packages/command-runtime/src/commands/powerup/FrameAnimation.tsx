import * as React from 'react'
import { useEffect, useState } from 'react'
import { Text } from '@anthropic/ink'

/** Default cycle interval (ms). Matches ant 4304.js's `$e` cadence. */
export const DEFAULT_FRAME_INTERVAL_MS = 1500

type Props = {
  frames: string[]
  /** ms between frame swaps. Default DEFAULT_FRAME_INTERVAL_MS (1500ms). */
  intervalMs?: number
}

/**
 * Pure index advancement. Wraps via modulo; single-frame and empty input
 * both return 0. Extracted as a pure function so the cycling math is unit
 * tested without mounting React (the `@anthropic/ink` fork ships no test
 * harness).
 */
export function nextFrameIndex(current: number, total: number): number {
  if (total <= 1) return 0
  return (current + 1) % total
}

/**
 * Cycles through string frames every `intervalMs`, rendering one at a time
 * inside an ink `<Text>`. Mirrors ant's `$e` component semantics in
 * 4304.js. The frame strings may contain embedded markers like
 * `[suggestion:foo]` and `[success:✓]` — for MVP they render verbatim;
 * a marker→colored-span parser is a future enhancement.
 *
 * The effect depends on the `frames` reference (not its length) so a
 * lesson swap that happens to keep the same frame count still resets
 * the timer AND the index — otherwise navigating from a 3-frame lesson
 * to another 3-frame lesson would silently keep the prior index. Single
 * frame and empty arrays skip the timer; we still call `setIndex(0)`
 * to clear stale state from a prior lesson.
 */
export function FrameAnimation({
  frames,
  intervalMs = DEFAULT_FRAME_INTERVAL_MS,
}: Props): React.ReactNode {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
    if (frames.length <= 1) return
    const t = setInterval(() => {
      setIndex(prev => nextFrameIndex(prev, frames.length))
    }, intervalMs)
    return () => clearInterval(t)
  }, [frames, intervalMs])

  return <Text>{frames[index] ?? ''}</Text>
}
