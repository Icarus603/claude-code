/**
 * WorkflowsDialog — `/workflows` history browser.
 *
 * Port of ant v2.1.150 4935.js GlK (the workflow-history list rendered by
 * 4936.js LlK.call). ant lists `local_workflow` tasks merged with persisted
 * workflow snapshots; each row shows a status icon, name, and stats
 * (agents · tokens · duration), with up/down to select, enter to view
 * detail, x to stop a running run, esc to close.
 *
 * The Workflow engine (packages/agent/workflow/) ships unconditionally now,
 * runtime-gated by isWorkflowsEnabled() (ant bp()). When the gate is on this
 * dialog is the real ant GlK — it lists live `local_workflow` tasks merged
 * with persisted workflow snapshots (readAllWorkflowSnapshots), x stops a
 * running run, enter views a run's stats.
 *
 * Fallback (gate off): the GOAL-history view lists `/goal` runs — the active
 * goal as the single "running" row, plus every completed / failed goal record
 * from the message log (newest first). Goals carry no separate per-run
 * artifact, so "enter" surfaces the run's condition + last reason as a system
 * message rather than opening a sub-dialog. (The /workflows command is hidden
 * when the gate is off, so this branch is normally unreachable — kept for
 * robustness.)
 *
 * Clean React (no _c() React-compiler memoization), per ccb conventions.
 */
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import figures from 'figures'
import { Box, Byline, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink'
import type { Theme } from '@anthropic/ink'
import { useKeybindings } from '@anthropic/ink/keybindings'
import type { Message } from '@claude-code/agent/messageShapes'
import {
  type ActiveGoal,
  findAllGoalRecords,
  formatDurationCompact,
  formatTokensCompact,
  type GoalRunRecord,
  isWorkflowsEnabled,
} from '@claude-code/agent/goalStopHook.js'
import { getTotalOutputTokens } from '@claude-code/app-host/bootstrap/state.js'
import type { CommandResultDisplay } from '@claude-code/command-runtime/runtime'
import { useRegisterOverlay } from '../../overlayContext.js'
import { useAppState, useSetAppState } from '../../appStateHooks.js'
import {
  killWorkflowTask,
  type LocalWorkflowTaskState,
} from '@claude-code/agent/tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import {
  readAllWorkflowSnapshots,
  type WorkflowSnapshot,
} from '@claude-code/agent/workflow/paths.js'

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
  color: keyof Theme | undefined
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

// ─────────────────── Workflow engine view (ant GlK) ───────────────────

type WorkflowRowData = {
  id: string
  name: string
  status: string
  agentCount: number
  tokens: number
  durationMs: number
  isRunning: boolean
  detail: string
}

function snapshotToRow(s: WorkflowSnapshot): WorkflowRowData {
  return {
    id: s.runId,
    name: s.workflowName || s.summary || 'Workflow',
    status: s.status,
    agentCount: s.agentCount,
    tokens: s.totalTokens,
    durationMs: s.durationMs,
    isRunning: false,
    detail: s.error ? `Error: ${s.error}` : s.summary || '',
  }
}

function taskToRow(t: LocalWorkflowTaskState): WorkflowRowData {
  return {
    id: t.workflowRunId,
    name: t.workflowName || t.summary || 'Workflow',
    status: t.status,
    agentCount: t.agentCount,
    tokens: t.totalTokens,
    durationMs: (t.endTime ?? Date.now()) - t.startTime,
    isRunning: t.status === 'running',
    detail: t.summary || '',
  }
}

function engineStatusGlyph(status: string): {
  glyph: string
  color: keyof Theme | undefined
} {
  switch (status) {
    case 'completed':
      return { glyph: figures.tick, color: 'success' }
    case 'failed':
    case 'killed':
      return { glyph: figures.cross, color: 'error' }
    default:
      return { glyph: '⟳', color: undefined }
  }
}

function WorkflowEngineView({
  onDone,
  taskId: _taskId,
}: {
  onDone: Props['onDone']
  taskId?: string
}): React.ReactNode {
  useRegisterOverlay('workflows-dialog')
  const setAppState = useSetAppState()
  const tasks = useAppState(s => s.tasks)
  const [snapshots, setSnapshots] = useState<WorkflowSnapshot[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    void readAllWorkflowSnapshots().then(s => {
      if (!cancelled) setSnapshots(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo<WorkflowRowData[]>(() => {
    const liveTasks = Object.values(tasks).filter(
      (t): t is LocalWorkflowTaskState => t.type === 'local_workflow',
    )
    const liveRows = liveTasks.map(taskToRow)
    const liveRunIds = new Set(liveRows.map(r => r.id))
    // Snapshots that don't have a live task (already-completed past runs).
    const snapRows = snapshots
      .filter(s => !liveRunIds.has(s.runId))
      .map(snapshotToRow)
    return [...liveRows, ...snapRows].sort((a, b) => {
      // running first, then by nothing stable available → keep insertion
      if (a.isRunning && !b.isRunning) return -1
      if (!a.isRunning && b.isRunning) return 1
      return 0
    })
  }, [tasks, snapshots])

  const runningCount = rows.filter(r => r.isRunning).length
  const completedCount = rows.length - runningCount

  const handleClose = () =>
    onDone('Workflows dialog dismissed', { display: 'system' })

  const handleView = () => {
    const row = rows[selectedIndex]
    if (!row) return
    const lines = [
      `Workflow: ${row.name}`,
      `Status: ${row.status}`,
      `Agents: ${row.agentCount}`,
      `Tokens: ${formatTokensCompact(row.tokens)}`,
      `Duration: ${formatDurationCompact(row.durationMs)}`,
    ]
    if (row.detail) lines.push(row.detail)
    onDone(lines.join('\n'), { display: 'system' })
  }

  const handleStop = () => {
    const row = rows[selectedIndex]
    if (!row || !row.isRunning) return
    const task = Object.values(tasks).find(
      (t): t is LocalWorkflowTaskState =>
        t.type === 'local_workflow' && t.workflowRunId === row.id,
    )
    if (task) killWorkflowTask(task.id, setAppState)
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

  const selected = rows[selectedIndex]
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
          ...(selected?.isRunning
            ? [<KeyboardShortcutHint key="x" shortcut="x" action="stop" />]
            : []),
        ]
      : []),
    <KeyboardShortcutHint key="esc" shortcut="←/Esc" action="close" />,
  ]

  // 'x' to stop the selected running workflow (ant m4O `x` handler). Raw key
  // handler (not a registered keybinding action) — matches BackgroundTasksDialog.
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'x' && selected?.isRunning) {
      e.preventDefault()
      handleStop()
    }
  }

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
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
            {rows.map((row, i) => {
              const { glyph, color } = engineStatusGlyph(row.status)
              const isSelected = i === selectedIndex
              const stats: string[] = []
              if (row.agentCount > 0) {
                stats.push(`${row.agentCount} ${plural(row.agentCount, 'agent')}`)
              }
              if (row.tokens > 0) stats.push(`${formatTokensCompact(row.tokens)} tok`)
              stats.push(formatDurationCompact(row.durationMs))
              const label = row.name.length > 50 ? `${row.name.slice(0, 49)}…` : row.name
              return (
                <Box key={row.id}>
                  <Text>{isSelected ? `${figures.pointer} ` : '  '}</Text>
                  <Text color={isSelected ? 'suggestion' : undefined}>
                    <Text color={color}>{glyph}</Text> {label}
                    <Text dimColor> {`  ${stats.join(' · ')}`}</Text>
                  </Text>
                </Box>
              )
            })}
          </Box>
        )}
      </Dialog>
    </Box>
  )
}

export function WorkflowsDialog({
  onDone,
  activeGoal,
  messages,
}: Props): React.ReactNode {
  // Workflow engine ships unconditionally now — when the runtime gate is on
  // (ant bp()), show real workflow runs (ant GlK). The goal-history view below
  // is retained as a fallback for builds/sessions where the gate is off (the
  // /workflows command is itself hidden then, but keep the view robust).
  if (isWorkflowsEnabled()) {
    return <WorkflowEngineView onDone={onDone} />
  }

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
