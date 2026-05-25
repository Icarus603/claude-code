/**
 * WorkflowsDialog — `/workflows` history browser.
 *
 * Port of ant v2.1.150 4935.js GlK (the workflow-history list rendered by
 * 4936.js LlK.call). ant lists `local_workflow` tasks merged with persisted
 * workflow snapshots; each row shows a status icon, name, and stats
 * (agents · tokens · duration), with up/down to select, enter to view
 * detail, x to stop a running run, esc to close.
 *
 * ccb has NO working Workflow-script subsystem (WorkflowTool /
 * LocalWorkflowTask are stubs) and no workflow snapshot store. Its real
 * autonomous-work primitive is `/goal` — a session-scoped Stop hook. Goal
 * "runs" live as `goal_status` attachments in the transcript. So this dialog
 * lists GOAL runs: the active goal as the single "running" row, plus every
 * completed / failed goal record from the message log (newest first).
 *
 * Detail view: goals carry no separate per-run artifact (logs / agent tree)
 * the way ant workflows do, so "enter" surfaces the run's condition + last
 * reason as a system message rather than opening a sub-dialog. This is the
 * faithful ccb adaptation — there is nothing more to show.
 *
 * Clean React (no _c() React-compiler memoization), per ccb conventions.
 */
import * as React from 'react'
import { useMemo, useState } from 'react'
import figures from 'figures'
import { Box, Byline, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink'
import { useKeybindings } from '@anthropic/ink/keybindings'
import type { Message } from '@claude-code/agent/messageShapes'
import {
  type ActiveGoal,
  findAllGoalRecords,
  formatDurationCompact,
  formatTokensCompact,
  type GoalRunRecord,
} from '@claude-code/agent/goalStopHook.js'
import { getTotalOutputTokens } from '@claude-code/app-host/bootstrap/state.js'
import type { CommandResultDisplay } from '@claude-code/command-runtime/runtime'
import { useRegisterOverlay } from '../../overlayContext.js'

type Props = {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
  activeGoal?: ActiveGoal
  messages: Message[]
}

type Row = {
  record: GoalRunRecord
  /** True for the live active goal (no terminal attachment yet). */
  isActive: boolean
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`
}

/** Status icon + theme color, mirroring ant m4O. */
function statusGlyph(status: GoalRunRecord['status']): {
  glyph: string
  color: string | undefined
} {
  switch (status) {
    case 'completed':
      return { glyph: figures.tick, color: 'success' }
    case 'failed':
      return { glyph: figures.cross, color: 'error' }
    default:
      return { glyph: '⟳', color: undefined }
  }
}

/** One list row: "‣ ✔ <condition>  <stats>" (ant m4O shape). */
function WorkflowRow({
  row,
  isSelected,
}: {
  row: Row
  isSelected: boolean
}): React.ReactNode {
  const { record } = row
  const { glyph, color } = statusGlyph(record.status)

  const stats: string[] = []
  if (record.iterations !== undefined && record.iterations > 0) {
    stats.push(`${record.iterations} ${plural(record.iterations, 'turn')}`)
  }
  if (record.tokens !== undefined && record.tokens > 0) {
    stats.push(`${formatTokensCompact(record.tokens)} tok`)
  }
  if (record.durationMs !== undefined) {
    stats.push(formatDurationCompact(record.durationMs))
  }

  const condition = record.condition || '(no condition)'
  const label = condition.length > 50 ? `${condition.slice(0, 49)}…` : condition
  const pointer = isSelected ? `${figures.pointer} ` : '  '
  const rowColor = isSelected ? 'suggestion' : undefined

  return (
    <Box>
      <Text>{pointer}</Text>
      <Text color={rowColor}>
        <Text color={color}>{glyph}</Text> {label}
        {stats.length > 0 && <Text dimColor> {`  ${stats.join(' · ')}`}</Text>}
      </Text>
    </Box>
  )
}

export function WorkflowsDialog({
  onDone,
  activeGoal,
  messages,
}: Props): React.ReactNode {
  useRegisterOverlay('workflows-dialog')

  const [selectedIndex, setSelectedIndex] = useState(0)

  const rows = useMemo<Row[]>(() => {
    const completed = findAllGoalRecords(messages)
    const list: Row[] = []
    // Active goal first (the single "running" row). It has no terminal
    // attachment yet, so synthesize a record from AppState — tokens computed
    // live from the goal baseline (matching GoalPanel).
    if (activeGoal) {
      let tokens: number | undefined
      try {
        tokens = getTotalOutputTokens() - activeGoal.tokensAtStart
      } catch {
        tokens = undefined
      }
      list.push({
        isActive: true,
        record: {
          id: 'active-goal',
          condition: activeGoal.condition,
          status: 'running',
          timestamp: activeGoal.setAt,
          iterations: activeGoal.iterations,
          durationMs: Date.now() - activeGoal.setAt,
          tokens,
          reason: activeGoal.lastReason,
        },
      })
    }
    for (const record of completed) {
      list.push({ isActive: false, record })
    }
    return list
  }, [messages, activeGoal])

  const runningCount = rows.filter(r => r.record.status === 'running').length
  const completedCount = rows.length - runningCount

  const handleClose = () =>
    onDone('Workflows dialog dismissed', { display: 'system' })

  const handleView = () => {
    const row = rows[selectedIndex]
    if (!row) return
    const { record } = row
    const lines = [`Goal: ${record.condition || '(no condition)'}`]
    const statusLabel =
      record.status === 'running'
        ? activeGoal?.paused
          ? 'paused'
          : 'running'
        : record.status
    lines.push(`Status: ${statusLabel}`)
    if (record.iterations !== undefined) {
      lines.push(`Turns: ${record.iterations}`)
    }
    if (record.durationMs !== undefined) {
      lines.push(`Duration: ${formatDurationCompact(record.durationMs)}`)
    }
    if (record.tokens !== undefined) {
      lines.push(`Tokens: ${formatTokensCompact(record.tokens)}`)
    }
    if (record.reason) {
      lines.push(`Last check: ${record.reason}`)
    }
    onDone(lines.join('\n'), { display: 'system' })
  }

  useKeybindings(
    {
      'confirm:previous': () => setSelectedIndex(prev => Math.max(0, prev - 1)),
      'confirm:next': () =>
        setSelectedIndex(prev => Math.min(rows.length - 1, prev + 1)),
      'confirm:yes': handleView,
    },
    { context: 'Confirmation', isActive: true },
  )

  const subtitle =
    rows.length === 0 ? undefined : (
      <Text dimColor>
        {[
          runningCount > 0 ? `${runningCount} running` : null,
          completedCount > 0 ? `${completedCount} completed` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    )

  const actions = [
    ...(rows.length > 0
      ? [
          <KeyboardShortcutHint key="upDown" shortcut="↑/↓" action="select" />,
          <KeyboardShortcutHint key="enter" shortcut="Enter" action="view" />,
        ]
      : []),
    <KeyboardShortcutHint key="esc" shortcut="←/Esc" action="close" />,
  ]

  return (
    <Box flexDirection="column">
      <Dialog
        title="Workflows"
        subtitle={subtitle}
        onCancel={handleClose}
        color="background"
        inputGuide={() => <Byline>{actions}</Byline>}
      >
        {rows.length === 0 ? (
          <Text dimColor>No workflows in this session.</Text>
        ) : (
          <Box flexDirection="column">
            {rows.map((row, i) => (
              <WorkflowRow
                key={row.record.id}
                row={row}
                isSelected={i === selectedIndex}
              />
            ))}
          </Box>
        )}
      </Dialog>
    </Box>
  )
}
