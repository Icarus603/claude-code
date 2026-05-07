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
 * Pure index advancement. Exported for unit-test coverage so the
 * cycling math is tested without mounting React. Wraps via modulo;
 * single-frame input returns 0; empty input returns 0.
 *
 * @dynamicRequire — referenced from the component via JSX, not a
 * dynamic import; this comment is a no-op for the verifier but flags
 * to readers that the helper is not dead code.
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
 * Sets up exactly one interval per mount and clears it on unmount; safe
 * to mount/unmount during lesson navigation. Single-frame and empty
 * input both skip the timer entirely.
 */
export function FrameAnimation({
  frames,
  intervalMs = DEFAULT_FRAME_INTERVAL_MS,
}: Props): React.ReactNode {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (frames.length <= 1) return
    const t = setInterval(() => {
      setIndex(prev => nextFrameIndex(prev, frames.length))
    }, intervalMs)
    return () => clearInterval(t)
  }, [frames.length, intervalMs])

  return <Text>{frames[index] ?? ''}</Text>
}
