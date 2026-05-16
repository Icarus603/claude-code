/**
 * FleetView top-of-screen banner.
 *
 * Source: ant 5092.js:3240-3260.
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ Claude Code v2.1.143                        │  line 1 — bold "Claude Code" + dim version
 *   │ Opus 4.7 · ~/code/vpn/learn                 │  line 2 — dim model · cwd
 *   │ 0 awaiting input · 10 working · 2 completed │  line 3 — dim 3-count triplet
 *   └─────────────────────────────────────────────┘
 *
 * The triplet counts come from `uyH` band classification:
 *   awaiting input = uyH === "blocked"
 *   working        = uyH === "active"
 *   completed      = uyH === "completed"
 *
 * Note: review-bucket rows are counted under "working" — ant's banner
 * intentionally collapses the visual triplet.
 */

import type React from 'react'
import { Box, Text } from '@anthropic/ink'

export interface FleetBannerProps {
  /** Display version (e.g. "v26.5.43" — caller passes "v" + MACRO.VERSION). */
  versionLabel: string
  /** Model display name (e.g. "Opus 4.7"). Omitted when empty. */
  modelLabel?: string
  /** Pretty cwd path (e.g. "~/code/vpn/learn"). Omitted when empty. */
  cwdLabel?: string
  /** Counts in the third line — caller derives via deriveBand. */
  bandCounts: {
    blocked: number
    active: number
    completed: number
  }
}

/** Source: ant banner block (5092.js:3240-3260). */
export function FleetBanner({
  versionLabel,
  modelLabel,
  cwdLabel,
  bandCounts,
}: FleetBannerProps): React.ReactNode {
  const subtitle = [modelLabel, cwdLabel].filter(s => s !== undefined && s !== '').join(' · ')
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Claude Code</Text>
        {' '}
        <Text dimColor>{versionLabel}</Text>
      </Text>
      {subtitle !== '' ? <Text dimColor>{subtitle}</Text> : null}
      <Text dimColor>
        {bandCounts.blocked} awaiting input · {bandCounts.active} working · {bandCounts.completed} completed
      </Text>
    </Box>
  )
}
