/**
 * GoalPanel — port of ant v2.1.142 4751.js NVK component.
 *
 * Rendered when `/goal` is invoked with no args in the interactive REPL.
 * Three states:
 *   1. Active — live-updating elapsed time, tokens, turns, condition,
 *      last reason, dismissal hint.
 *   2. Achieved — last completed goal stats (duration, turns, tokens,
 *      condition) with "set another" hint.
 *   3. No goal — simple hint prompting the user to set one.
 *
 * ant uses a full panel overlay (N6); ccb renders as a focused status
 * block displayed via onDone({display:'system'}) in the goal JSX handler.
 */
import * as React from 'react'
import { useEffect, useState } from 'react'
import { Box, Text } from '@anthropic/ink'
import type { Message } from '@claude-code/agent/messageShapes'
import type { ActiveGoal } from '@claude-code/agent/goalStopHook.js'
import {
  findMostRecentMetGoalStatus,
  formatDurationCompact,
  formatTokensCompact,
  formatLastCheck,
} from '@claude-code/agent/goalStopHook.js'
import { getTotalOutputTokens } from '@claude-code/app-host/bootstrap/state.js'

/** Refresh interval for live stats (every 1s for goals < 60s old). */
const LIVE_REFRESH_MS = 1000

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`
}

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`
  if (diffMs < 7 * 86_400_000) return `${Math.round(diffMs / 86_400_000)}d ago`
  return d.toISOString().slice(0, 10)
}

export function GoalPanel(props: {
  activeGoal?: ActiveGoal
  messages: Message[]
}): React.ReactNode {
  const { activeGoal, messages } = props
  const [, tick] = useState(0)

  // Live-refresh every second while a goal is active so elapsed time
  // and token counters update in real time (ant NVK timer loop).
  useEffect(() => {
    if (!activeGoal) return
    const id = setInterval(() => tick(v => v + 1), LIVE_REFRESH_MS)
    return () => clearInterval(id)
  }, [activeGoal])

  // ── State 1: Active goal ──────────────────────────────────────────
  if (activeGoal) {
    const elapsedMs = Date.now() - activeGoal.setAt
    const elapsed = formatDurationCompact(elapsedMs)
    const tokensSince = getTotalOutputTokens() - activeGoal.tokensAtStart
    const tokensLabel = `${formatTokensCompact(tokensSince)} tokens`

    const statParts: string[] = [`running ${elapsed}`]
    if (activeGoal.iterations > 0) {
      statParts.push(
        `${activeGoal.iterations} ${plural(activeGoal.iterations, 'turn')}`,
      )
    }
    statParts.push(tokensLabel)
    const subtitle = statParts.join(' · ')

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text>⏺ </Text>
          <Text>Goal active</Text>
        </Box>
        <Box paddingLeft={2}>
          <Text dimColor>{subtitle}</Text>
        </Box>
        <Box paddingLeft={2} flexDirection="column">
          <Box flexDirection="row">
            <Text dimColor>Goal: </Text>
            <Text wrap="wrap">{activeGoal.condition}</Text>
          </Box>
          {activeGoal.lastReason && (
            <Box flexDirection="row">
              <Text dimColor>
                {formatLastCheck(activeGoal.lastReason)}
              </Text>
            </Box>
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            /goal clear to stop early · esc to dismiss
          </Text>
        </Box>
      </Box>
    )
  }

  // ── State 2: Last achieved goal ───────────────────────────────────
  const last = findMostRecentMetGoalStatus(messages)
  if (last) {
    const parts = last.stats
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="success">✔ </Text>
          <Text>Goal achieved</Text>
        </Box>
        <Box paddingLeft={2}>
          <Text dimColor>{parts}</Text>
        </Box>
        <Box paddingLeft={2} flexDirection="row">
          <Text dimColor>Goal: </Text>
          <Text wrap="wrap">{last.condition}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            /goal {'<condition>'} to set another · esc to dismiss
          </Text>
        </Box>
      </Box>
    )
  }

  // ── State 3: No goal ──────────────────────────────────────────────
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text>Goal</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>No goal set</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          /goal {'<condition>'} to set one · esc to dismiss
        </Text>
      </Box>
    </Box>
  )
}
