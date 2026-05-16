/**
 * Inline reply panel rendered below the selected row when the user
 * presses `space` on a job.
 *
 * Source: ant gs3 (5092.js:785-1336) — the full peek panel. ant's
 * implementation owns inline edit + bash-mode toggle + multi-line
 * paste handling via the zZ input hook; for ccb's first cut we keep
 * a focused subset that matches the screenshot UX:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ > reply                                      │   prompt + input
 *   └──────────────────────────────────────────────┘
 *
 *   (the surrounding row stays visible; footer chord cascade switches
 *    to "enter to open · space to close · ctrl+x to delete")
 *
 * Keys:
 *   enter on non-empty   → submit (call onSubmit, then close)
 *   enter on empty       → close (no submit)
 *   space on empty       → close
 *   escape               → close
 *
 * The actual `onSubmit` plumbing lives in Phase 6 hook
 * (`useFleetActions.peekSubmit`) — the panel itself is purely UI.
 */

import type React from 'react'
import { useCallback } from 'react'
import { Box, Text } from '@anthropic/ink'

import TextInput from '../../../components/TextInput.js'

export interface PeekPanelProps {
  /** Current draft text. Caller owns state. */
  value: string
  /** Setter for the draft text. */
  onValueChange: (next: string) => void
  /** Cursor offset within the draft. */
  cursorOffset: number
  /** Setter for cursor offset. */
  onCursorChange: (offset: number) => void
  /** Submit handler — called with the trimmed draft (called only when non-empty). */
  onSubmit: (text: string) => void
  /** Close handler — called on enter-on-empty. Caller wires escape/space-on-empty separately. */
  onClose: () => void
  /** Terminal column width for input wrapping. */
  columns: number
  /** Optional placeholder shown when value is empty. */
  placeholder?: string
}

/** Source: ant gs3 (peek panel render skeleton). */
export function PeekPanel({
  value,
  onValueChange,
  cursorOffset,
  onCursorChange,
  onSubmit,
  onClose,
  columns,
  placeholder = 'reply',
}: PeekPanelProps): React.ReactNode {
  const handleSubmit = useCallback(
    (submitted: string) => {
      const trimmed = submitted.trim()
      if (trimmed === '') {
        onClose()
        return
      }
      onSubmit(trimmed)
    },
    [onClose, onSubmit],
  )

  return (
    <Box
      borderStyle="round"
      paddingX={1}
      borderColor="bashBorder"
      flexDirection="column"
    >
      <Box>
        <Text color="bashBorder">{'> '}</Text>
        <TextInput
          value={value}
          onChange={onValueChange}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={onCursorChange}
          onSubmit={handleSubmit}
          placeholder={placeholder}
          focus={true}
          multiline={true}
          columns={Math.max(columns - 6, 20)}
        />
      </Box>
    </Box>
  )
}
