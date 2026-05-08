import * as React from 'react'
import { useState } from 'react'
import { Box, Text, type Theme } from '@anthropic/ink'
import { useKeybindings } from '@anthropic/ink/keybindings'

/**
 * Live "Press shift+tab now" widget for the `modes` lesson, mirroring
 * ant 4302.js `s8K`. Cycles through the 4 permission-mode preview labels
 * each time the user presses shift+tab inside the /powerup detail view.
 *
 * The `confirm:cycleMode` keybinding is registered repo-wide as shift+tab
 * (see `packages/repl/src/keybindings/schema.ts`). Registering it here
 * under the `Confirmation` context means our handler only fires while the
 * lesson detail is mounted — it does not interfere with the real
 * permission-mode cycler that runs at the REPL prompt.
 *
 * Visual structure (matches ant 4302.js n8K):
 *   <Box borderStyle="round" borderColor="inactive" width=48 height=5>
 *     content area:
 *       "Press shift+tab now"   (dim line, the prompt)
 *       <empty>
 *       "{symbol} {label}"      (current mode preview)
 *     ◆ try it                  (top-right label, claude colour — the
 *                                only "live"/highlighted element on the
 *                                widget; the box border itself stays
 *                                inactive to match every other demo box)
 *   </Box>
 */

type ModePreview = {
  label: string
  /** Glyph shown to the left of the label. Empty for `default` (no glyph in ant). */
  symbol: string
  /** Theme colour for the label + glyph. */
  color: keyof Theme
}

/** Mode preview list — matches ant 4303.js i8K. */
const MODES: readonly ModePreview[] = [
  { label: 'default', symbol: '', color: 'text' },
  { label: 'accept edits on', symbol: '⏵⏵', color: 'autoAccept' },
  { label: 'plan mode on', symbol: '⏸', color: 'planMode' },
  { label: 'auto mode on', symbol: '⏵⏵', color: 'warning' },
] as const

/** Box dimensions — matches ant 4302.js Xv8 (48) and d8K + 2 (5). */
const FRAME_BOX_WIDTH = 48
const FRAME_BOX_CONTENT_HEIGHT = 3

/** Top-right label glyph — matches ant 0644.js zL = "\u25C6" (◆). */
const TRY_IT_GLYPH = '◆'

export function LiveModeCycler(): React.ReactNode {
  const [index, setIndex] = useState(0)

  // ant binds confirm:cycleMode (shift+tab) under "Confirmation" so the
  // global mode cycler at the prompt does not steal the keystroke while
  // a lesson is open.
  useKeybindings(
    {
      'confirm:cycleMode': () => {
        setIndex(prev => (prev + 1) % MODES.length)
      },
    },
    { context: 'Confirmation' },
  )

  const current = MODES[index]!
  const symbolWithSpace = current.symbol ? `${current.symbol} ` : '  '

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
        <Text dimColor>Press shift+tab now</Text>
        <Text> </Text>
        <Text color={current.color}>
          {symbolWithSpace}
          {current.label}
        </Text>
      </Box>
      {/* Top-right "◆ try it" label. ant 4302.js:16 uses no leading
          spaces here (vs. the demo box's `  ◐ demo` which has two);
          adding spaces overflows the box and clips "try it". */}
      <Box position="absolute" marginLeft={FRAME_BOX_WIDTH - 12}>
        <Text color="claude">{`${TRY_IT_GLYPH} try it`}</Text>
      </Box>
    </Box>
  )
}
