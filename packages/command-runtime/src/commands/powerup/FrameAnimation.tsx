import * as React from 'react'
import { useEffect, useState } from 'react'
import { Box, Text, type Theme } from '@anthropic/ink'
import { parseFrame, type FrameLine, type FrameSegment } from './frameMarkers.js'

/** Default cycle interval (ms). Matches ant 4302.js Q8K = 3000. */
export const DEFAULT_FRAME_INTERVAL_MS = 3000

/** Box dimensions. Matches ant 4302.js Xv8 (width 48) and d8K + 2 (height 5). */
const FRAME_BOX_WIDTH = 48
const FRAME_BOX_CONTENT_HEIGHT = 3

/** Demo label glyph. Matches ant 0644.js Xv_ = "\u25D0" (◐). */
const DEMO_GLYPH = '◐'

type Props = {
  frames: string[]
  /** ms between frame swaps. Default DEFAULT_FRAME_INTERVAL_MS (3000ms). */
  intervalMs?: number
}

/**
 * Pure index advancement. Wraps via modulo; single-frame and empty input
 * both return 0.
 */
export function nextFrameIndex(current: number, total: number): number {
  if (total <= 1) return 0
  return (current + 1) % total
}

/**
 * Cycles through frame strings every `intervalMs`, rendering one frame at
 * a time inside a rounded `inactive`-colored box (width 48 × height 5)
 * with an absolutely-positioned `◐ demo` label on the top-right of the
 * border. Mirrors ant's `n8K` + `$e` (4302.js).
 *
 * Frame strings carry markers that the parser turns into colored
 * segments — see `frameMarkers.ts`. Lines starting with `#` render in
 * dimColor; `[color:text]` blocks render with the named theme color.
 *
 * Single-frame and empty arrays skip the timer entirely; the index
 * still resets to 0 on `frames` identity change.
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

  const currentFrame = frames[index] ?? ''
  const lines = parseFrame(currentFrame)

  return (
    <Box
      borderStyle="round"
      borderColor="inactive"
      paddingX={1}
      width={FRAME_BOX_WIDTH}
      height={FRAME_BOX_CONTENT_HEIGHT + 2}
    >
      <Box
        flexDirection="column"
        width={FRAME_BOX_WIDTH - 4}
        height={FRAME_BOX_CONTENT_HEIGHT}
      >
        {lines.map((line, i) => (
          <FrameLineRow key={i} line={line} />
        ))}
      </Box>
      <Box position="absolute" marginLeft={FRAME_BOX_WIDTH - 12}>
        <Text dimColor>{`  ${DEMO_GLYPH} demo`}</Text>
      </Box>
    </Box>
  )
}

function FrameLineRow({ line }: { line: FrameLine }): React.ReactNode {
  return (
    <Text dimColor={line.dim}>
      {line.segments.map((seg, i) => (
        <FrameSegmentSpan key={i} segment={seg} />
      ))}
    </Text>
  )
}

function FrameSegmentSpan({
  segment,
}: {
  segment: FrameSegment
}): React.ReactNode {
  if (segment.color) {
    // Marker colors are theme key names (e.g. 'success', 'warning', 'claude').
    // Text accepts `keyof Theme | Color`; we cast from string to keyof Theme.
    // Unknown names degrade to default — ThemedText does not crash on unresolved keys.
    return <Text color={segment.color as keyof Theme}>{segment.text}</Text>
  }
  return <Text>{segment.text}</Text>
}
