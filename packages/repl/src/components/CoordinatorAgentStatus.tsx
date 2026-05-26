/**
 * CoordinatorTaskPanel — Steerable list of background agents.
 *
 * Renders below the prompt input footer whenever local_agent tasks exist.
 * Visibility is driven by evictAfter: undefined (running/retained) shows
 * always; a timestamp shows until passed. Enter to view/steer, x to dismiss.
 */

import figures from 'figures'
import * as React from 'react'
import { BLACK_CIRCLE } from '@claude-code/output/constants/figures.js'
import type { Theme } from '@anthropic/ink'
import { useTerminalSize } from '@anthropic/ink'
import { Box, Byline, KeyboardShortcutHint, Text, stringWidth, wrapText } from '@anthropic/ink'
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js'
import {
  type AppState,
  useAppState,
  useSetAppState,
} from '../appStateHooks.js'
import {
  enterTeammateView,
  exitTeammateView,
} from '../teammateViewHelpers.js'
import {
  isPanelAgentTask,
  type LocalAgentTaskState,
} from '@claude-code/agent/localAgentTask.js'
import { formatDuration, formatNumber } from '@claude-code/output/formatters'
import { evictTerminalTask } from '@claude-code/agent/taskFramework.js'
import {
  isBgAgentPanelEnabled,
  isTerminalStatus,
} from './tasks/taskStatusUtils.js'

export { isBgAgentPanelEnabled }

/**
 * Which panel-managed tasks currently have a visible row.
 * Presence in AppState.tasks IS visibility — the 1s tick in
 * CoordinatorTaskPanel evicts tasks past their evictAfter deadline. The
 * evictAfter !== 0 check handles immediate dismiss (x key) without making
 * the filter time-dependent. Shared by panel render, useCoordinatorTaskCount,
 * and index resolvers so the math can't drift.
 */
export function getVisibleAgentTasks(
  tasks: AppState['tasks'],
): LocalAgentTaskState[] {
  return Object.values(tasks)
    .filter(
      (t): t is LocalAgentTaskState =>
        isPanelAgentTask(t) && t.evictAfter !== 0,
    )
    .sort((a, b) => a.startTime - b.startTime)
}

export function CoordinatorTaskPanel(): React.ReactNode {
  const tasks = useAppState(s => s.tasks)
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId)
  const agentNameRegistry = useAppState(s => s.agentNameRegistry)
  const coordinatorTaskIndex = useAppState(s => s.coordinatorTaskIndex)
  const tasksSelected = useAppState(s => s.footerSelection === 'tasks')
  const selectedIndex = tasksSelected ? coordinatorTaskIndex : undefined
  const setAppState = useSetAppState()

  const visibleTasks = getVisibleAgentTasks(tasks)
  const hasTasks = Object.values(tasks).some(isPanelAgentTask)
  const killAllShortcut = useShortcutDisplay(
    'chat:killAgents',
    'Chat',
    'ctrl+x ctrl+k',
  )

  // 1s tick: re-render for elapsed time + evict tasks past their deadline.
  // The eviction deletes from prev.tasks, which makes useCoordinatorTaskCount
  // (and other consumers) see the updated count without their own tick.
  const tasksRef = React.useRef(tasks)
  tasksRef.current = tasks
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    if (!hasTasks) return
    const interval = setInterval(
      (tasksRef, setAppState, setTick) => {
        const now = Date.now()
        for (const t of Object.values(tasksRef.current)) {
          if (isPanelAgentTask(t) && (t.evictAfter ?? Infinity) <= now) {
            evictTerminalTask(t.id, setAppState)
          }
        }
        setTick((prev: number) => prev + 1)
      },
      1000,
      tasksRef,
      setAppState,
      setTick,
    )
    return () => clearInterval(interval)
  }, [hasTasks, setAppState])
  const nameByAgentId = React.useMemo(() => {
    const inv = new Map<string, string>()
    for (const [n, id] of agentNameRegistry) inv.set(id, n)
    return inv
  }, [agentNameRegistry])

  if (visibleTasks.length === 0) {
    return null
  }

  // Hint shown on the MainLine's right edge — byte-for-byte ant `V64` (5129.js).
  // `focused` = the agent row the cursor is parked on (index 0 is "main", so
  // index>0 maps to visibleTasks[index-1]). When an agent row is focused the
  // hint is `Enter view · x clear/stop` (+ `stop all agents` when >1 running);
  // otherwise (cursor on main, or panel unfocused) it's `↑/↓ select · Enter view`.
  const focused =
    selectedIndex !== undefined && selectedIndex > 0
      ? visibleTasks[selectedIndex - 1]
      : undefined
  const runningCount = visibleTasks.filter(
    t => !isTerminalStatus(t.status),
  ).length
  const hint = focused ? (
    <Byline>
      <KeyboardShortcutHint shortcut="Enter" action="view" />
      <KeyboardShortcutHint
        shortcut="x"
        action={isTerminalStatus(focused.status) ? 'clear' : 'stop'}
      />
      {runningCount > 1 && (
        <KeyboardShortcutHint
          shortcut={killAllShortcut}
          action="stop all agents"
        />
      )}
    </Byline>
  ) : (
    <Byline>
      <KeyboardShortcutHint shortcut="↑/↓" action="select" />
      <KeyboardShortcutHint shortcut="Enter" action="view" />
    </Byline>
  )

  return (
    <Box flexDirection="column" marginTop={1}>
      <MainLine
        isSelected={selectedIndex === 0}
        isViewed={viewingAgentTaskId === undefined}
        hint={hint}
        onClick={() => exitTeammateView(setAppState)}
      />
      {visibleTasks.map((task, i) => (
        <AgentLine
          key={task.id}
          task={task}
          name={nameByAgentId.get(task.id)}
          isSelected={selectedIndex === i + 1}
          isViewed={viewingAgentTaskId === task.id}
          onClick={() => enterTeammateView(task.id, setAppState)}
        />
      ))}
    </Box>
  )
}

/**
 * Returns the number of visible coordinator tasks (for selection bounds).
 * The panel's 1s tick evicts expired tasks from prev.tasks, so this count
 * stays accurate without needing its own tick.
 */
export function useCoordinatorTaskCount(): number {
  const tasks = useAppState(s => s.tasks)
  return React.useMemo(() => {
    if (!isBgAgentPanelEnabled()) return 0
    const count = getVisibleAgentTasks(tasks).length
    return count > 0 ? count + 1 : 0
  }, [tasks])
}

function MainLine({
  isSelected,
  isViewed,
  hint,
  onClick,
}: {
  isSelected?: boolean
  isViewed?: boolean
  hint?: React.ReactNode
  onClick: () => void
}): React.ReactNode {
  const [hover, setHover] = React.useState(false)
  const prefix = isSelected || hover ? figures.pointer + ' ' : '  '
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle
  // ant `ejO` (5129.js): the "main" label sits left, the hint right, via
  // justifyContent: space-between on the row Box.
  return (
    <Box
      justifyContent="space-between"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Text dimColor={!isSelected && !isViewed && !hover} bold={isViewed}>
        {prefix}
        {bullet} main
      </Text>
      {hint}
    </Box>
  )
}

type AgentLineProps = {
  task: LocalAgentTaskState
  name?: string
  isSelected?: boolean
  isViewed?: boolean
  onClick?: () => void
}

/**
 * Bullet color by status — byte-for-byte ant `ojO` (5129.js): completed→success,
 * failed→error, killed→inactive, running/pending→undefined (no color). ant
 * conveys task state through the bullet COLOR alone; it has no play/pause
 * separator glyph. Earlier ccb rendered a homerolled `▶`/`⏸` separator — removed
 * to match `HJO`.
 */
function statusBulletColor(status: string): keyof Theme | undefined {
  switch (status) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
    case 'killed':
      return 'inactive'
    default:
      return undefined
  }
}

function AgentLine({
  task,
  name,
  isSelected,
  isViewed,
  onClick,
}: AgentLineProps): React.ReactNode {
  const { columns } = useTerminalSize()
  const [hover, setHover] = React.useState(false)
  const isRunning = !isTerminalStatus(task.status)
  const pausedMs = task.totalPausedMs ?? 0
  const elapsedMs = Math.max(
    0,
    isRunning
      ? Date.now() - task.startTime - pausedMs
      : (task.endTime ?? task.startTime) - task.startTime - pausedMs,
  )

  const elapsed = formatDuration(elapsedMs)
  const tokenCount = task.progress?.tokenCount

  // Token-throughput direction arrow — lives INSIDE tokenText, not as a row
  // separator (ant `ajO`: `progress.lastActivity ? arrowDown : arrowUp`).
  const lastActivity = task.progress?.lastActivity
  const arrow = lastActivity ? figures.arrowDown : figures.arrowUp

  const tokenText =
    tokenCount !== undefined && tokenCount > 0
      ? ` · ${arrow} ${formatNumber(tokenCount)} tokens`
      : ''

  const queuedCount = task.pendingMessages.length
  const queuedText = queuedCount > 0 ? ` · ${queuedCount} queued` : ''

  // Precedence: AI summary > static description (no tool-call activity noise)
  const displayDescription = task.progress?.summary || task.description

  const highlighted = isSelected || hover
  const prefix = highlighted ? figures.pointer + ' ' : '  '
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle
  const bulletColor = statusBulletColor(task.status)
  const dim = !highlighted && !isViewed

  // Name is the steering handle — kept out of truncation and undimmed so it
  // stays readable even when the row is inactive. Short by convention (the
  // Agent tool prompt asks for "one or two words, lowercase").
  const namePart = name ? `${name}: ` : ''
  const hintPart =
    isSelected && !isViewed ? ` · x to ${isRunning ? 'stop' : 'clear'}` : ''
  const suffixPart = ` ${elapsed}${tokenText}${queuedText}${hintPart}`
  const availableForDesc =
    columns -
    stringWidth(prefix) -
    stringWidth(`${bullet} `) -
    stringWidth(namePart) -
    stringWidth(suffixPart)
  const truncated = wrapText(
    displayDescription,
    Math.max(0, availableForDesc),
    'truncate-end',
  )

  const line = (
    <Text dimColor={dim} bold={isViewed}>
      {prefix}
      <Text color={bulletColor}>{bullet}</Text>{' '}
      {name && (
        <>
          <Text dimColor={false} bold>
            {name}
          </Text>
          {': '}
        </>
      )}
      {truncated} {elapsed}
      {tokenText}
      {queuedCount > 0 && <Text color="warning">{queuedText}</Text>}
      {hintPart && <Text dimColor>{hintPart}</Text>}
    </Text>
  )

  if (!onClick) return line
  return (
    <Box
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {line}
    </Box>
  )
}
