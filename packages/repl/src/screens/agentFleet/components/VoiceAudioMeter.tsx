/**
 * Audio-level meter rendered next to the voice indicator in the input
 * area. Source: ant ss3 (5092.js:3612-3620) driven by Cs_ (2464.js:17-34).
 *
 * Reuses ccb's existing voice-mode color primitives:
 *   - `hueToRgb` (repl/Spinner/utils) is 1:1 with ant `Ss_` (HSL fixed S=0.7 L=0.6)
 *   - `toRGBColor` returns the `rgb(r,g,b)` string Text accepts
 *
 * Behaviour:
 *   - Renders only while voiceState === "recording" and reducedMotion off
 *   - 50ms tick advances time
 *   - EMA-smooths the audio level (alpha=0.7, gain=1.8 to ≤1.0)
 *   - Maps to a block char " ▁▂▃▄▅▆▇█" (idx 1..8)
 *   - Sub-threshold (<0.15) → mute grey, else hue rotates 90°/s
 */

import type React from 'react'
import { useEffect, useRef } from 'react'
import { Box, Text, useAnimationFrame } from '@anthropic/ink'

import { useSettings } from '../../../hooks/useSettings.js'
import { useVoiceState } from '@claude-code/voice/voiceContext.js'
import { hueToRgb, toRGBColor } from '../../../components/Spinner/utils.js'

const BLOCK_CHARS = ' ▁▂▃▄▅▆▇█'
const EMA_ALPHA = 0.7
const LEVEL_GAIN = 1.8
const MUTE_THRESHOLD = 0.15
const MUTE_RGB = { r: 128, g: 128, b: 128 }

/** Source: ant ss3 + Cs_. */
export function VoiceAudioMeter(): React.ReactNode {
  const voiceState = useVoiceState(s => s.voiceState)
  const audioLevels = useVoiceState(s => s.voiceAudioLevels)
  const settings = useSettings()
  const reducedMotion = settings?.prefersReducedMotion ?? false
  const active = voiceState === 'recording' && !reducedMotion

  // EMA state — reset on recording-start transition (ant `if (q && !e58) ST_=0`).
  const emaRef = useRef(0)
  const wasActiveRef = useRef(false)
  useEffect(() => {
    if (active && !wasActiveRef.current) emaRef.current = 0
    wasActiveRef.current = active
  }, [active])

  const [ref, time] = useAnimationFrame(active ? 50 : null)
  if (!active) return null

  const lastLevel = audioLevels.at(-1) ?? 0
  const boosted = Math.min(lastLevel * LEVEL_GAIN, 1)
  emaRef.current = emaRef.current * EMA_ALPHA + boosted * (1 - EMA_ALPHA)

  const level = emaRef.current
  const blockIdx = Math.max(
    1,
    Math.min(Math.round(level * (BLOCK_CHARS.length - 1)), BLOCK_CHARS.length - 1),
  )
  const muted = lastLevel < MUTE_THRESHOLD
  const hueDeg = ((time / 1000) * 90) % 360
  const rgb = toRGBColor(muted ? MUTE_RGB : hueToRgb(hueDeg))

  return (
    <Box ref={ref}>
      <Text color={rgb}>{BLOCK_CHARS[blockIdx]}</Text>
    </Box>
  )
}
