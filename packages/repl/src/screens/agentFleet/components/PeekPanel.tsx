/**
 * Peek panel — full job summary + child rows + output sections + reply input.
 *
 * Source: ant 5092.js gs3 (15454-22000+). ant's peek panel renders 4
 * stacked sections (all conditional on `job.state` shape):
 *
 *   1. Age + detail / needs (only when no children/outputs)
 *   2. Child rows — PR/issue links with status icons + diff stats
 *   3. Output sections — one block per named output (state.output)
 *   4. Questions panel (when tempo==='blocked' && block.questions)
 *      OR a `needs` block when waiting for input
 *   5. Reply input box at the bottom (bash-mode toggle: type `!`)
 *
 * Previous ccb cut rendered ONLY (5) — user reported "完全空 + 一個
 * reply box". This rewrite ports the data sections so peek shows the
 * session's recent output and what it's waiting on.
 *
 * The reply input remains the focus owner — keyboard cascade still
 * goes through FleetView's main `useInput`, which routes peek-typed
 * characters into `peekDraft` via the existing TextInput.
 */

import type React from 'react'
import { useCallback } from 'react'
import { Box, Text, type Theme } from '@anthropic/ink'

import type { FleetJob } from '@claude-code/agent/background/fleet/fleetTypes.js'
import TextInput from '../../../components/TextInput.js'

export interface PeekPanelProps {
  /** Focused job — drives all summary/output/child rendering. */
  job: FleetJob
  /** Current draft text. Caller owns state. */
  value: string
  /** Setter for the draft text. */
  onValueChange: (next: string) => void
  /** Cursor offset within the draft. */
  cursorOffset: number
  /** Setter for cursor offset. */
  onCursorChange: (offset: number) => void
  /** Submit handler — called with the trimmed draft (only when non-empty). */
  onSubmit: (text: string) => void
  /** Close handler — called on enter-on-empty. */
  onClose: () => void
  /** Terminal column width for input wrapping. */
  columns: number
  /** Optional placeholder shown when value is empty. */
  placeholder?: string
}

/**
 * Compute age label from updatedAt. Source: ant gs3 `v = HK(L, {mostSignificantOnly:!0})`
 * — short relative timestamp like "1m", "2h", "3d".
 */
function formatAge(updatedAt: string): string {
  const ms = Math.max(0, Date.now() - Date.parse(updatedAt))
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

/**
 * Tempo → theme color. Source: ant `Ti8(state, activity, status)` color
 * field — `blocked` red, `active` yellow, idle/done dim.
 */
function tempoColor(job: FleetJob): keyof Theme {
  const t = job.state.tempo
  if (t === 'blocked') return 'error'
  if (t === 'active') return 'warning'
  if (t === 'idle') return 'text'
  return 'text'
}

export function PeekPanel({
  job,
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

  const age = formatAge(job.state.updatedAt)
  const color = tempoColor(job)

  // Child rows. ant `c_` = `gH = w.slice(0, dH)` mapped to `<B>{icon}{label}{diff}{status}</B>`.
  // For ccb's first cut: render kind/label only (no diff stat / status icons yet — those
  // come from the prCache pipeline which the user isn't focused on right now).
  const children = job.state.children ?? []

  // Named outputs. ant `WH = KH.map(...)` — Object.entries(state.output)
  // filtered to drop entries already covered by child labels.
  const outputs = Object.entries(job.state.output ?? {})

  // Has anything to show above the reply input?
  const hasContent =
    children.length > 0 ||
    outputs.length > 0 ||
    !!job.state.needs ||
    !!job.state.detail

  return (
    <Box
      borderStyle="round"
      paddingX={1}
      paddingY={0}
      borderColor={color}
      flexDirection="column"
    >
      {/* (1) Age + state summary line. Always rendered. */}
      <Box>
        <Text color={color}>{age}</Text>
        <Text> </Text>
        <Text dimColor>{job.state.template}</Text>
        {job.state.intent ? (
          <>
            <Text dimColor> · </Text>
            <Text wrap="truncate-end">{job.state.intent}</Text>
          </>
        ) : null}
      </Box>

      {/* (2) Children — PR/issue links from `state.children`. */}
      {children.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {children.slice(0, 8).map(child => (
            <Box key={child.href}>
              <Box width={2} flexShrink={0}>
                <Text dimColor>·</Text>
              </Box>
              <Box flexGrow={1} width={0}>
                <Text wrap="truncate">{child.label ?? child.href}</Text>
              </Box>
            </Box>
          ))}
          {children.length > 8 ? (
            <Box paddingLeft={2}>
              <Text dimColor>… {children.length - 8} more</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {/* (3) Named outputs — primary content the user wants to peek at. */}
      {outputs.length > 0 ? (
        <Box flexDirection="column" marginTop={children.length > 0 ? 1 : 1}>
          {outputs.map(([name, text]) => (
            <Box key={name} flexDirection="column" marginTop={1}>
              {outputs.length > 1 ? (
                <Text dimColor>{name}</Text>
              ) : null}
              <Box maxHeight={6} overflowY="hidden">
                <Text wrap="wrap">{text}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}

      {/* (4) Needs / detail. ant: `state.needs` shown as blocked-input prompt
          when non-empty AND no questions panel; else `state.detail` as
          neutral status line when there are no other sections. */}
      {job.state.needs ? (
        <Box marginTop={hasContent ? 1 : 0} maxHeight={4} overflowY="hidden">
          <Text wrap="wrap">
            <Text color={color}>↳ </Text>
            <Text>{job.state.needs}</Text>
          </Text>
        </Box>
      ) : !children.length && !outputs.length && job.state.detail ? (
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            {job.state.detail}
          </Text>
        </Box>
      ) : null}

      {/* (5) Reply input — bottom row. */}
      <Box marginTop={hasContent ? 1 : 0}>
        <Text color={color}>{'> '}</Text>
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
