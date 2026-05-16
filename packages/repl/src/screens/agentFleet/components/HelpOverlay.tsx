/**
 * `?` keyboard-shortcuts overlay.
 *
 * Source: ant ts3 (5092.js:3621-3656) — 2-column shortcut grid rendered
 * dim-italic. Shortcut visibility is gated on selection state (canReorder,
 * canRename, canMention, canPin) and `altOpenCount` (the number of recent
 * sessions reachable via `alt+1..N`).
 *
 * Render order:
 *   shift+↑↓ to reorder         (canReorder)
 *   ctrl+r to rename            (canRename)
 *   ctrl+s to switch views      (always)
 *   @ to mention                (canMention)
 *   ctrl+t to (pin to top|unpin)(canPin — label depends on focusedPinned)
 *   alt+1[-N] to open           (altOpenCount > 0)
 *   esc to quit                 (always)
 *   ? to close                  (always)
 *
 * Lines are grouped into pairs and rendered as 2 columns side by side
 * via `Box flexDirection="row" gap=4`.
 */

import type React from 'react'
import { Box, Text } from '@anthropic/ink'
import figures from 'figures'

export interface HelpOverlayProps {
  /** Whether the currently-focused row is pinned (drives ctrl+t label). */
  focusedPinned: boolean
  /** Whether reorder shortcut is shown (typically when a job row is focused). */
  canReorder: boolean
  /** Whether rename shortcut is shown. */
  canRename: boolean
  /** Whether pin shortcut is shown. */
  canPin: boolean
  /** Whether @-mention shortcut is shown (when dispatch input is active). */
  canMention: boolean
  /** Number of recent sessions reachable via alt+N (0 → suppress alt hint). */
  altOpenCount: number
}

function buildShortcutLines(props: HelpOverlayProps): string[] {
  const lines: string[] = []
  if (props.canReorder) lines.push(`shift+${figures.arrowUp}${figures.arrowDown} to reorder`)
  if (props.canRename) lines.push('ctrl+r to rename')
  lines.push('ctrl+s to switch views')
  if (props.canMention) lines.push('@ to mention')
  if (props.canPin) {
    lines.push(`ctrl+t to ${props.focusedPinned ? 'unpin' : 'pin to top'}`)
  }
  if (props.altOpenCount > 0) {
    lines.push(`alt+1${props.altOpenCount > 1 ? `-${props.altOpenCount}` : ''} to open`)
  }
  lines.push('esc to quit')
  lines.push('? to close')
  return lines
}

function chunkPairs<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2))
  return out
}

/** Source: ant ts3. */
export function HelpOverlay(props: HelpOverlayProps): React.ReactNode {
  const lines = buildShortcutLines(props)
  const columns = chunkPairs(lines)
  return (
    <Box flexShrink={0} paddingX={2} flexDirection="row" gap={4}>
      {columns.map((col, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable order; lines are fixed by gating flags
        <Box key={i} flexDirection="column">
          {col.map(line => (
            <Text key={line} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}
