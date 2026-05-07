import * as React from 'react'
import { Box, Text, useTerminalSize } from '@anthropic/ink'

const RULE_CHAR = '─'
const PANEL_PADDING_X = 2
const PANEL_PADDING_TOP = 1

/**
 * Wraps content with a horizontal rule on top (claude-colored) plus a
 * `paddingX={2}` content area. Mirrors ant 2453.js G1.
 *
 * The rule spans the full terminal width minus the content padding so it
 * visually indicates a section break the way ant does in /powerup. Unlike
 * a full Box border, this is just the top edge — same effect as ant.
 */
export function TopRulePanel({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  const { columns } = useTerminalSize()
  // Full-width rule, but never longer than the terminal. Matches ant FT
  // behaviour (4302.js:50): repeats `─` to fill the column width.
  const ruleWidth = Math.max(0, columns)
  return (
    <Box flexDirection="column" paddingTop={PANEL_PADDING_TOP}>
      <Text color="claude">{RULE_CHAR.repeat(ruleWidth)}</Text>
      <Box flexDirection="column" paddingX={PANEL_PADDING_X}>
        {children}
      </Box>
    </Box>
  )
}
