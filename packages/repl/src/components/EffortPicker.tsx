import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Box, Text, useTerminalSize } from '@anthropic/ink'
import { useKeybindings } from '@anthropic/ink/keybindings'
import {
  EFFORT_LEVELS,
  type EffortLevel,
  modelSupportsMaxEffort,
  modelSupportsXhighEffort,
} from '@claude-code/agent/effort.js'

export type EffortPickerProps = {
  /** Currently-applied level (used for initial focus). */
  current: EffortLevel
  /** The active model — drives which levels are unlocked (xhigh/max gating). */
  model: string
  /** Called with the chosen level on Enter. */
  onConfirm: (level: EffortLevel) => void
  /** Called on Esc — value unchanged. */
  onCancel: () => void
}

// Each focused level gets its own distinct hue. Picked to span the
// full intelligence/speed gradient: warm at low end, cool at high end,
// with xhigh and max getting attention-grabbing effects.
//
// Direct hex values (not theme tokens) so the rainbow on `max` reads as
// a real rainbow instead of whatever the theme's accent palette ships.
const LEVEL_COLOR: Record<Exclude<EffortLevel, 'max' | 'xhigh'>, string> = {
  low: '#ffd24d', // warm yellow
  medium: '#5cd66b', // fresh green
  high: '#4aa8ff', // cyan-blue
}

// Seven-stop rainbow (ROYGBIV). Cycled per character on `max`.
const RAINBOW: ReadonlyArray<string> = [
  '#ff3b3b', // red
  '#ff8c1a', // orange
  '#ffd24d', // yellow
  '#3ee06f', // green
  '#3aa6ff', // blue
  '#7a5cff', // indigo
  '#c45cff', // violet
]

// `xhigh` shimmer — alternating bright magenta and pale lilac so it reads
// as flowing light without going full rainbow.
const XHIGH_SHIMMER: ReadonlyArray<string> = [
  '#c45cff',
  '#dba0ff',
  '#ffffff',
  '#dba0ff',
]

// Animation pace. 250ms / 4fps — visible motion, near-zero CPU.
const ANIMATION_FRAME_MS = 250

// Fixed cell width. All level labels render at this width whether
// focused or not, so the row never re-flows when the cursor moves.
const CELL_WIDTH = 10

/** Frame counter; ticks only while `active` so static rows stay cheap. */
function useAnimationFrame(active: boolean): number {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setFrame(f => f + 1), ANIMATION_FRAME_MS)
    return () => clearInterval(id)
  }, [active])
  return active ? frame : 0
}

/**
 * Render `text` with each character coloured from `palette`, advancing
 * one position per frame so the gradient flows left-to-right. Wraps
 * inside a fixed-width cell so neighbouring cells don't shift.
 */
function FlowingText({
  text,
  palette,
  frame,
  width,
}: {
  text: string
  palette: ReadonlyArray<string>
  frame: number
  width: number
}): React.ReactNode {
  const padded = text.padEnd(width)
  return (
    <Text>
      {padded.split('').map((ch, i) => {
        if (ch === ' ') {
          return (
            <Text key={i}>
              {' '}
            </Text>
          )
        }
        return (
          <Text
            key={i}
            // hex color literal — Ink accepts `#rrggbb` directly
            color={palette[(frame + i) % palette.length] as never}
            bold
          >
            {ch}
          </Text>
        )
      })}
    </Text>
  )
}

export function EffortPicker({
  current,
  model,
  onConfirm,
  onCancel,
}: EffortPickerProps): React.ReactNode {
  // Filter levels by model capability. Below-tier levels are hidden.
  const availableLevels = useMemo<EffortLevel[]>(
    () =>
      EFFORT_LEVELS.filter(level => {
        if (level === 'xhigh') return modelSupportsXhighEffort(model)
        if (level === 'max') return modelSupportsMaxEffort(model)
        return true
      }),
    [model],
  )

  // Clamp initial focus.
  const initialIndex = Math.max(
    0,
    availableLevels.indexOf(
      availableLevels.includes(current) ? current : 'high',
    ),
  )
  const [focusedIndex, setFocusedIndex] = useState(initialIndex)
  const focusedLevel = availableLevels[focusedIndex] ?? 'high'

  useKeybindings(
    {
      'effortPicker:decrease': () =>
        setFocusedIndex(i => Math.max(0, i - 1)),
      'effortPicker:increase': () =>
        setFocusedIndex(i => Math.min(availableLevels.length - 1, i + 1)),
      'effortPicker:confirm': () => onConfirm(focusedLevel),
      'effortPicker:cancel': () => onCancel(),
    },
    { context: 'EffortPicker' },
  )

  // Animate only while a flowing-effect level is focused.
  const isAnimating = focusedLevel === 'xhigh' || focusedLevel === 'max'
  const frame = useAnimationFrame(isAnimating)

  // ── Geometry ───────────────────────────────────────────────────────────
  const totalWidth = availableLevels.length * CELL_WIDTH
  const arrowChars = availableLevels.map((_, i) =>
    i === focusedIndex ? '▲' : ' ',
  )
  // Centre the ▲ within its CELL_WIDTH column so it sits over the level
  // label below.
  const arrowLine = arrowChars
    .map(c => {
      const padLeft = Math.floor((CELL_WIDTH - 1) / 2)
      const padRight = CELL_WIDTH - 1 - padLeft
      return ' '.repeat(padLeft) + c + ' '.repeat(padRight)
    })
    .join('')
  const trackLine = '─'.repeat(totalWidth)

  // Centre the whole picker block in the terminal width.
  const { columns } = useTerminalSize()
  const leftPad = Math.max(0, Math.floor((columns - totalWidth) / 2))
  const padBox = ' '.repeat(leftPad)

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* Faster / Smarter axis labels */}
      <Box flexDirection="row">
        <Text>{padBox}</Text>
        <Box width={totalWidth} flexDirection="row" justifyContent="space-between">
          <Text dimColor italic>
            Faster
          </Text>
          <Text dimColor italic>
            Smarter
          </Text>
        </Box>
      </Box>

      {/* Track line */}
      <Box flexDirection="row">
        <Text>{padBox}</Text>
        <Text dimColor>{trackLine}</Text>
      </Box>

      {/* Triangle indicator */}
      <Box flexDirection="row">
        <Text>{padBox}</Text>
        <Text>{arrowLine}</Text>
      </Box>

      {/* Level labels — every cell is fixed-width so the row never reflows. */}
      <Box flexDirection="row">
        <Text>{padBox}</Text>
        <Box flexDirection="row">
          {availableLevels.map((level, i) => {
            const isFocused = i === focusedIndex
            // Centre the label inside its CELL_WIDTH column for stable layout.
            const labelPadL = Math.floor((CELL_WIDTH - level.length) / 2)
            const labelPadR = CELL_WIDTH - level.length - labelPadL
            const cellLabel =
              ' '.repeat(labelPadL) + level + ' '.repeat(labelPadR)

            if (!isFocused) {
              return (
                <Text key={level} dimColor>
                  {cellLabel}
                </Text>
              )
            }
            // Focused: per-level colour / animation.
            if (level === 'max') {
              return (
                <FlowingText
                  key={level}
                  text={cellLabel}
                  palette={RAINBOW}
                  frame={frame}
                  width={CELL_WIDTH}
                />
              )
            }
            if (level === 'xhigh') {
              return (
                <FlowingText
                  key={level}
                  text={cellLabel}
                  palette={XHIGH_SHIMMER}
                  frame={frame}
                  width={CELL_WIDTH}
                />
              )
            }
            return (
              <Text
                key={level}
                color={
                  LEVEL_COLOR[
                    level as Exclude<EffortLevel, 'max' | 'xhigh'>
                  ] as never
                }
                bold
              >
                {cellLabel}
              </Text>
            )
          })}
        </Box>
      </Box>

      {/* Hint */}
      <Box marginTop={1}>
        <Text dimColor>
          ←/→ to change effort · Enter to confirm · Esc to cancel
        </Text>
      </Box>
    </Box>
  )
}
