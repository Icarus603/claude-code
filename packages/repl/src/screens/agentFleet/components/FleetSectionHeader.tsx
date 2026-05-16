/**
 * Section-header row — renders the bucket label (or repo group label
 * when grouped by repo) with optional count badge when the section is
 * collapsed.
 *
 * Source: ant section header at 5092.js:3289-3320.
 *
 *   Expanded:   "Ready for review"  (italic, bold when focused)
 *   Collapsed:  "Ready for review 3" (label + space + count, focused
 *                                    rows hidden until expand)
 *
 * Focused selection is rendered by the outer renderer via inverse
 * background — this component only renders the label/count itself.
 */

import type React from 'react'
import { Box, Text } from '@anthropic/ink'

interface FleetSectionHeaderProps {
  label: string
  /** Number of rows in this bucket — shown when collapsed. */
  rowCount: number
  /** True when the section's rows are hidden (collapsed state). */
  collapsed: boolean
  /** True when this header is the currently-focused list item. */
  focused: boolean
  /** Column width to fill so selection background spans the row. */
  width: number
}

/**
 * Source: ant `fBK[bucket]` header rendering (5076.js inside Sc8).
 *
 *   N_.createElement(V, {bold: Y4||C6, dimColor: !C6}, ...)
 *
 * Where `C6` is focus (or armed-fold), `Y4` is the fold-armed marker.
 * No italic — that was added by mistake. Bold = focused/armed, dim = not focused.
 */
export function FleetSectionHeader({
  label,
  rowCount,
  collapsed,
  focused,
  width,
}: FleetSectionHeaderProps): React.ReactNode {
  return (
    <Box
      width={width}
      backgroundColor={focused ? 'userMessageBackground' : undefined}
    >
      <Text bold={focused} dimColor={!focused}>
        {label}
        {collapsed && rowCount > 0 ? ` ${rowCount}` : ''}
      </Text>
    </Box>
  )
}
