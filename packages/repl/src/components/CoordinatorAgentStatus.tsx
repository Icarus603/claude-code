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
import { Box, Byline, KeyboardShortcutHint, Text, stringWidth } from '@anthropic/ink'
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

/**
 * Remap the coordinator cursor index across an agent-list change — byte-for-byte
 * ant `k64` (5129.js). When the visible agent list changes (an agent is killed,
 * dismissed, or a new one spawns), the cursor should STAY ON THE SAME AGENT
 * (matched by id), not blindly clamp to an index. `H` = current index (1-based:
 * 0 is "main"), `prevIds`/`nextIds` = the agent-id lists before/after the change.
 * Walk back from the cursor's old agent and return the first surviving agent's
 * new index (+1 for the main offset); fall back to main (0) if all gone.
 *
 * This is the fix for the cursor-reset race: ccb's old clamp compared the index
 * against a possibly-stale count and snapped the cursor back to 0 right after a
 * ↓ moved it onto an agent row, so `x` always saw index 0 (main → fall-through).
 */
export function remapCoordinatorIndex(
  index: number,
  prevIds: string[],
  nextIds: string[],
): number {
  if (index < 1) return index
  for (let k = Math.min(index, prevIds.length) - 1; k >= 0; k--) {
    const o = nextIds.indexOf(prevIds[k]!)
    if (o !== -1) return o + 1
  }
  return 0
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

  // ant `V64` (5129.js): two shared column widths drive the aligned grid.
  // labelWidth = the widest agent name/agentType, clamped 4..24 (ant `X`);
  // statusWidth = the widest "elapsed+tokenText+queuedText" run (ant `W`), so
  // every row's right-edge status column lines up. Both measured with
  // stringWidth (ant `D6` = Bun.stringWidth).
  const statusParts = visibleTasks.map(buildStatusParts)
  const labelWidth = Math.min(
    24,
    Math.max(
      4,
      ...visibleTasks.map(t =>
        stringWidth(nameByAgentId.get(t.id) ?? t.agentType),
      ),
    ),
  )
  const statusWidth = Math.max(
    0,
    ...statusParts.map(p =>
      stringWidth(p.elapsed + p.tokenText + p.queuedText),
    ),
  )

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
        labelWidth={labelWidth}
        onClick={() => exitTeammateView(setAppState)}
      />
      {visibleTasks.map((task, i) => (
        <AgentLine
          key={task.id}
          task={task}
          name={nameByAgentId.get(task.id)}
          isSelected={selectedIndex === i + 1}
          isViewed={viewingAgentTaskId === task.id}
          labelWidth={labelWidth}
          statusWidth={statusWidth}
          statusParts={statusParts[i]!}
          onClick={() => enterTeammateView(task.id, setAppState)}
        />
      ))}
    </Box>
  )
}

/** Prefix/bullet column width — ant `J6_ = 4` (5128.js): `"❯ ● "`. */
const PREFIX_BULLET_WIDTH = 4

type StatusParts = {
  elapsed: string
  tokenText: string
  queuedText: string
  queuedCount: number
}

/**
 * Per-row status fields — byte-for-byte ant `ajO` (5129.js). elapsed (paused
 * time subtracted), tokenText (` · ${↓|↑} ${n} tokens`, the arrow is throughput
 * direction NOT a row separator), queuedText (` · ${n} queued`). No play/pause
 * glyph — ant conveys run state via the bullet COLOR only (`ojO`).
 */
function buildStatusParts(task: LocalAgentTaskState): StatusParts {
  const running = !isTerminalStatus(task.status)
  const pausedMs = task.totalPausedMs ?? 0
  const elapsedMs = Math.max(
    0,
    running
      ? Date.now() - task.startTime - pausedMs
      : (task.endTime ?? task.startTime) - task.startTime - pausedMs,
  )
  const tokenCount = task.progress?.tokenCount
  const arrow = task.progress?.lastActivity
    ? figures.arrowDown
    : figures.arrowUp
  const tokenText =
    tokenCount !== undefined && tokenCount > 0
      ? ` · ${arrow} ${formatNumber(tokenCount)} tokens`
      : ''
  const queuedCount = task.pendingMessages.length
  return {
    elapsed: formatDuration(elapsedMs),
    tokenText,
    queuedText: queuedCount > 0 ? ` · ${queuedCount} queued` : '',
    queuedCount,
  }
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

/**
 * MainLine — byte-for-byte ant `ejO` (5129.js). The "main" label sits in a
 * FIXED-WIDTH box (labelWidth + prefix/bullet padding), the hint in a single
 * <Text> on the right, separated by justifyContent: space-between. The
 * fixed-width label box is what makes the hint land cleanly at the right edge;
 * wrapping the hint in <Text> keeps its middot-separated children flowing
 * inline instead of scattering as flex items across the row.
 */
function MainLine({
  isSelected,
  isViewed,
  hint,
  labelWidth,
  onClick,
}: {
  isSelected?: boolean
  isViewed?: boolean
  hint?: React.ReactNode
  labelWidth: number
  onClick: () => void
}): React.ReactNode {
  const [hover, setHover] = React.useState(false)
  const prefix = isSelected || hover ? figures.pointer + ' ' : '  '
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle
  const dim = !isSelected && !isViewed && !hover
  return (
    <Box
      justifyContent="space-between"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Box width={labelWidth + PREFIX_BULLET_WIDTH} flexShrink={0}>
        <Text dimColor={dim} bold={isViewed}>
          {prefix}
          {bullet} main
        </Text>
      </Box>
      <Text dimColor>{hint}</Text>
    </Box>
  )
}

type AgentLineProps = {
  task: LocalAgentTaskState
  name?: string
  isSelected?: boolean
  isViewed?: boolean
  labelWidth: number
  statusWidth: number
  statusParts: StatusParts
  onClick?: () => void
}

/**
 * Bullet color by status — byte-for-byte ant `ojO` (5129.js): completed→success,
 * failed→error, killed→inactive, running/pending→undefined (no color). ant
 * conveys task state through the bullet COLOR alone; it has no play/pause
 * separator glyph.
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

/**
 * AgentLine — byte-for-byte ant `HJO` (5129.js). A four-column flex row:
 *   1. prefix+bullet box (fixed width PREFIX_BULLET_WIDTH=4): `❯ ●`, bullet
 *      colored by status (`ojO`).
 *   2. name box (fixed width labelWidth): the steering handle (`name` or
 *      agentType), bold when named/viewed, truncated.
 *   3. description (flexGrow:1, width:0, paddingLeft:2): summary||description,
 *      truncated — this column absorbs the slack so the status column stays
 *      right-aligned.
 *   4. status box (minWidth statusWidth, marginLeft:1, justifyContent:flex-end):
 *      `elapsed tokenText queuedText`, right-aligned so every row's status
 *      lines up.
 * The decoration path (ant `O?.content`) is ant-only (Tungsten live monitor);
 * ccb has no taskDecorations, so only the no-decoration branch is ported.
 */
function AgentLine({
  task,
  name,
  isSelected,
  isViewed,
  labelWidth,
  statusWidth,
  statusParts,
  onClick,
}: AgentLineProps): React.ReactNode {
  const [hover, setHover] = React.useState(false)
  const { elapsed, tokenText, queuedText, queuedCount } = statusParts
  const description = task.progress?.summary || task.description
  const highlighted = isSelected || hover
  const prefix = highlighted ? figures.pointer + ' ' : '  '
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle
  const bulletColor = statusBulletColor(task.status)
  const dim = !highlighted && !isViewed
  const displayName = name ?? task.agentType

  return (
    <Box
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* col 1 — prefix + status-colored bullet */}
      <Box width={PREFIX_BULLET_WIDTH} flexShrink={0}>
        <Text dimColor={dim} bold={isViewed}>
          {prefix}
        </Text>
        <Text color={bulletColor} dimColor={!bulletColor && dim} bold={isViewed}>
          {bullet}{' '}
        </Text>
      </Box>
      {/* col 2 — name (steering handle), fixed width */}
      <Box width={labelWidth} flexShrink={0}>
        <Text bold={!!name || isViewed} dimColor={!name && dim} wrap="truncate">
          {displayName}
        </Text>
      </Box>
      {/* col 3 — description, absorbs slack */}
      <Box flexGrow={1} width={0} paddingLeft={2}>
        <Text dimColor={dim} bold={isViewed} wrap="truncate">
          {description}
        </Text>
      </Box>
      {/* col 4 — status, right-aligned, shared minWidth */}
      <Box
        minWidth={statusWidth}
        flexShrink={0}
        marginLeft={1}
        justifyContent="flex-end"
      >
        <Text dimColor={dim} bold={isViewed}>
          {elapsed}
          {tokenText}
          {queuedCount > 0 && <Text color="warning">{queuedText}</Text>}
        </Text>
      </Box>
    </Box>
  )
}
