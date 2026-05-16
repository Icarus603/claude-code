/**
 * Audio-level meter rendered next to the voice indicator in the input
 * area. Source: ant ss3 (5092.js:3612-3620) driven by Cs_ (2464.js:17-34).
 *
 * Behavior:
 *   - Only rendered while voiceState === "recording" and reducedMotion off
 *   - 50ms tick reads the latest voice audio level
 *   - EMA-smooths the level: `state = state * 0.7 + level * 0.3`
 *   - Maps to a block char from " ▁▂▃▄▅▆▇█" (8 levels, idx 1..8)
 *   - Sub-threshold (<0.15) → grey, else HSL hue rotates 90deg/s
 *
 * The EMA state resets at every recording-start transition (mimics ant
 * km9 reset and the `if (q && !e58) ST_ = 0` invariant).
 */

import type React from 'react'
import { useEffect, useRef } from 'react'
import { Text, useAnimationFrame } from '@anthropic/ink'

import { useSettings } from '../../../hooks/useSettings.js'
import { useVoiceState } from '@claude-code/voice/voiceContext.js'

const BLOCK_CHARS = ' ▁▂▃▄▅▆▇█'
const EMA_ALPHA = 0.7
const LEVEL_GAIN = 1.8
const MUTE_THRESHOLD = 0.15

interface RGB {
  r: number
  g: number
  b: number
}

/**
 * Source: ant Ss_ (2463.js:42-63). HSL→RGB with fixed S=0.7, L=0.6.
 */
function hslHueToRgb(degrees: number): RGB {
  const h = ((degrees % 360) + 360) % 360
  const chroma = 0.7 * (1 - Math.abs(2 * 0.6 - 1)) // C = (1 - |2L-1|) * S
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = 0.6 - chroma / 2 // L - C/2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = chroma
    g = x
  } else if (h < 120) {
    r = x
    g = chroma
  } else if (h < 180) {
    g = chroma
    b = x
  } else if (h < 240) {
    g = x
    b = chroma
  } else if (h < 300) {
    r = x
    b = chroma
  } else {
    r = chroma
    b = x
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function toHex({ r, g, b }: RGB): string {
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/** Source: ant ss3 + Cs_. */
export function VoiceAudioMeter(): React.ReactNode {
  const voiceState = useVoiceState(s => s.voiceState)
  const audioLevels = useVoiceState(s => s.voiceAudioLevels)
  const settings = useSettings()
  const reducedMotion = settings.prefersReducedMotion ?? false
  const active = voiceState === 'recording' && !reducedMotion

  // EMA state — reset on recording-start transition.
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
  const rgb = muted ? { r: 128, g: 128, b: 128 } : hslHueToRgb(hueDeg)
  const hex = toHex(rgb)

  return (
    <Text ref={ref} color={hex}>
      {BLOCK_CHARS[blockIdx]}
    </Text>
  )
}
