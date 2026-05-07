import * as React from 'react'
import { useEffect, useState } from 'react'
import { Text } from '@anthropic/ink'

/** Cycle interval. Ant's `c8K = 80ms` per shimmer step. */
const SHIMMER_INTERVAL_MS = 80

/** Shimmer halo width — total characters lit per frame. Ant's `o96` lights
 * indices i-1, i, i+1 → 3 chars wide. */
const SHIMMER_WIDTH = 3

type Props = {
  text: string
}

/**
 * Renders `text` in `bold claude`, with a 3-character `claudeShimmer`
 * halo that sweeps left-to-right across the string and back. Mirrors
 * ant 4302.js a8K.
 *
 * Uses Unicode-naive character indexing (`Array.from(text)` to handle
 * surrogate pairs and emoji like `✨`). Animation pauses gracefully on
 * very short text.
 */
export function CelebrationShimmer({ text }: Props): React.ReactNode {
  const chars = Array.from(text)
  const length = chars.length
  // Sweep from -SHIMMER_WIDTH (offscreen left) through length+SHIMMER_WIDTH
  // (offscreen right) and back via modulo.
  const sweepRange = length + 2 * SHIMMER_WIDTH

  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (length === 0) return
    const t = setInterval(() => setTick(prev => prev + 1), SHIMMER_INTERVAL_MS)
    return () => clearInterval(t)
  }, [length])

  if (length === 0) {
    return <Text bold color="claude">{text}</Text>
  }

  const center = (tick % sweepRange) - SHIMMER_WIDTH
  return (
    <Text>
      {chars.map((ch, i) => {
        const inHalo = Math.abs(i - center) < SHIMMER_WIDTH
        return (
          <Text
            key={i}
            bold
            color={inHalo ? 'claudeShimmer' : 'claude'}
          >
            {ch}
          </Text>
        )
      })}
    </Text>
  )
}
