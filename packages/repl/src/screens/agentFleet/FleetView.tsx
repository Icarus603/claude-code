/**
 * FleetView — top-level Ink screen for the `ccb agents` TUI dashboard.
 *
 * Source: ant 5092.js BdK (line 1657) + the surrounding mount Ot3 (3839).
 *
 * Responsibilities:
 *   - Own UI state (selection index, filter buffer, group mode,
 *     collapsed-section set, armed-delete, renaming, peek state, help).
 *   - Subscribe to job + presence + PR polling.
 *   - Compose Banner / Section rows / Job rows / Fold rows / Footer.
 *   - Render PeekPanel / HelpOverlay as overlays.
 *   - Route input via useFleetInputDispatcher to hook handlers.
 *
 * This is the keystone — Phase 7 wires together every Phase 1-6 piece.
 */

import type React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Box, useInput, useTerminalSize } from '@anthropic/ink'

import type {
  FleetJob,
  FleetPrCache,
} from '@claude-code/agent/background/fleet/fleetTypes.js'

import { FleetBanner } from './components/FleetBanner.js'
import { FleetFooter, type FleetFooterSelectionKind } from './components/FleetFooter.js'
import { FleetJobRow } from './components/FleetJobRow.js'
import { FleetSectionHeader } from './components/FleetSectionHeader.js'
import { HelpOverlay } from './components/HelpOverlay.js'
import { PeekPanel } from './components/PeekPanel.js'

import { formatJobAge } from './helpers/elapsed.js'
import { deriveBand } from './helpers/deriveBand.js'

import { useFleetActions } from './hooks/useFleetActions.js'
import { useFleetInputDispatcher } from './hooks/useFleetInput.js'
import { useFleetPolling } from './hooks/useFleetPolling.js'
import {
  type FleetGroupMode,
  type FleetRow,
  useFleetRows,
} from './hooks/useFleetRows.js'

export interface FleetViewProps {
  /** Bundled version label (e.g. "v26.5.43"). */
  versionLabel: string
  /** Display model name (e.g. "Opus 4.7"). */
  modelLabel?: string
  /** Pretty cwd label (e.g. "~/code/foo"). */
  cwdLabel?: string
  /** Current foreground session id (drives "current session" labelling). */
  currentSessionId: string
  /** Optional seed jobs to render before first poll completes. */
  seedJobs?: readonly FleetJob[]
  /** Optional callback when user hits ctrl+c / quits. */
  onQuit?: () => void
  /** Optional callback to attach to a job's PTY (kind === 'job' enter). */
  onAttach?: (short: string) => void
  /** PR cache passed through from caller (Phase 7 leaves undefined). */
  prCache?: FleetPrCache
}

/** Top-level FleetView. Source: ant BdK. */
export function FleetView(props: FleetViewProps): React.ReactNode {
  const {
    versionLabel,
    modelLabel,
    cwdLabel,
    currentSessionId,
    seedJobs,
    onQuit,
    onAttach,
    prCache,
  } = props

  const terminalWidth = useTerminalSize().columns

  const { jobs, presence } = useFleetPolling(seedJobs)
  const actions = useFleetActions({ currentSessionId })

  const [filterText, setFilterText] = useState('')
  const [groupMode, setGroupMode] = useState<FleetGroupMode>('state')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [selectionIndex, setSelectionIndex] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [peekOpen, setPeekOpen] = useState(false)
  const [peekDraft, setPeekDraft] = useState('')
  const [peekCursor, setPeekCursor] = useState(0)
  const [armedDeleteId, setArmedDeleteId] = useState<string | undefined>(undefined)

  const { rows, bucketCounts, groupCounts } = useFleetRows({
    jobs,
    filterText,
    groupMode,
    presence,
    prCache,
    collapsedGroups,
    currentSessionId,
  })

  const clampedIndex = rows.length === 0 ? 0 : Math.min(selectionIndex, rows.length - 1)
  const focused = rows[clampedIndex]

  const focusedJob = focused?.kind === 'job' ? focused.job : undefined

  const labelWidth = useMemo(() => 24, [])
  const ageWidth = useMemo(() => 6, [])

  // Banner band counts use uyH (deriveBand), distinct from PZ6 bucket counts.
  const bandCounts = useMemo(() => {
    const counts = { blocked: 0, active: 0, completed: 0 }
    for (const job of jobs) {
      const band = deriveBand(job.state, presence.get(job.id))
      if (band === 'blocked') counts.blocked += 1
      else if (band === 'active') counts.active += 1
      else counts.completed += 1
    }
    return counts
  }, [jobs, presence])

  void bucketCounts // PR-cache-driven; used by future review-bucket logic
  void groupCounts

  // ─── input dispatch ────────────────────────────────────────────────
  const handleQuit = useCallback((): void => {
    if (onQuit !== undefined) onQuit()
  }, [onQuit])

  const handleMove = useCallback(
    (delta: number): void => {
      if (rows.length === 0) return
      let next = clampedIndex + delta
      // Skip past header rows when stepping (mimics ant `Id` step helper).
      while (next >= 0 && next < rows.length && rows[next]?.kind === 'header' && delta !== 0) {
        next += delta
      }
      next = Math.max(0, Math.min(rows.length - 1, next))
      setSelectionIndex(next)
    },
    [rows, clampedIndex],
  )

  const handleEnter = useCallback((): void => {
    if (!focused) return
    if (focused.kind === 'header') {
      setCollapsedGroups(prev => {
        const next = new Set(prev)
        if (next.has(focused.group)) next.delete(focused.group)
        else next.add(focused.group)
        return next
      })
      return
    }
    if (focused.kind === 'fold') {
      setCollapsedGroups(prev => {
        const next = new Set(prev)
        next.delete(focused.group)
        return next
      })
      return
    }
    if (focused.kind === 'job') {
      onAttach?.(focused.job.id)
    }
  }, [focused, onAttach])

  const handleSpace = useCallback((): void => {
    if (focused?.kind !== 'job') return
    setPeekOpen(true)
  }, [focused])

  const handleEscape = useCallback((): void => {
    if (helpOpen) {
      setHelpOpen(false)
      return
    }
    if (peekOpen) {
      setPeekOpen(false)
      setPeekDraft('')
      setPeekCursor(0)
      return
    }
    if (filterText !== '') {
      setFilterText('')
      return
    }
    if (armedDeleteId !== undefined) {
      setArmedDeleteId(undefined)
      return
    }
  }, [helpOpen, peekOpen, filterText, armedDeleteId])

  const handleToggleHelp = useCallback((): void => setHelpOpen(prev => !prev), [])

  const handleToggleGroupMode = useCallback((): void => {
    setGroupMode(prev => (prev === 'state' ? 'directory' : 'state'))
  }, [])

  const handleTogglePin = useCallback((): void => {
    if (focusedJob === undefined) return
    const next = focusedJob.state.pinned !== true
    void actions.togglePin(focusedJob.id, next)
  }, [focusedJob, actions])

  const handleArmDelete = useCallback((): void => {
    if (focusedJob === undefined) return
    if (armedDeleteId === focusedJob.id) {
      void actions.kill(focusedJob.id)
      setArmedDeleteId(undefined)
      return
    }
    setArmedDeleteId(focusedJob.id)
  }, [focusedJob, armedDeleteId, actions])

  const dispatchInput = useFleetInputDispatcher({
    onMove: handleMove,
    onEnter: handleEnter,
    onSpace: handleSpace,
    onEscape: handleEscape,
    onQuit: handleQuit,
    onToggleHelp: handleToggleHelp,
    onTogglePin: handleTogglePin,
    onToggleGroupMode: handleToggleGroupMode,
    onArmDelete: handleArmDelete,
    onTextInput: ch => setFilterText(prev => prev + ch),
    onBackspace: () => setFilterText(prev => prev.slice(0, -1)),
  })

  useInput((input, key) => {
    if (peekOpen) return // PeekPanel's TextInput owns input while open
    if (helpOpen && input !== '?' && !key.escape) return
    dispatchInput(input, key)
  })

  // ─── peek submit / close ───────────────────────────────────────────
  const handlePeekSubmit = useCallback(
    (text: string): void => {
      if (focusedJob !== undefined) {
        void actions.reply(focusedJob.id, text)
      }
      setPeekOpen(false)
      setPeekDraft('')
      setPeekCursor(0)
    },
    [focusedJob, actions],
  )

  const handlePeekClose = useCallback((): void => {
    setPeekOpen(false)
    setPeekDraft('')
    setPeekCursor(0)
  }, [])

  // ─── selection kind for footer ─────────────────────────────────────
  const selectionKind: FleetFooterSelectionKind =
    focused === undefined
      ? 'none'
      : focused.kind === 'job'
        ? 'job'
        : focused.kind === 'header'
          ? 'header'
          : 'fold'

  const isHeaderCollapsed =
    focused?.kind === 'header' ? collapsedGroups.has(focused.group) : false

  const hasDeletableJobs = useMemo(
    () => jobs.some(j => j.state.tempo === 'idle' || j.state.state === 'failed'),
    [jobs],
  )

  // ─── render ────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">
      <FleetBanner
        versionLabel={versionLabel}
        modelLabel={modelLabel}
        cwdLabel={cwdLabel}
        bandCounts={bandCounts}
      />
      <Box flexDirection="column" marginTop={1}>
        {rows.map((row, idx) => (
          <Row
            key={rowKey(row, idx)}
            row={row}
            focused={idx === clampedIndex}
            currentSessionId={currentSessionId}
            armedDeleteId={armedDeleteId}
            terminalWidth={terminalWidth}
            labelWidth={labelWidth}
            ageWidth={ageWidth}
            collapsed={row.kind === 'header' && collapsedGroups.has(row.group)}
            prCache={prCache}
          />
        ))}
      </Box>
      {peekOpen && focusedJob !== undefined ? (
        <Box marginTop={1}>
          <PeekPanel
            value={peekDraft}
            onValueChange={setPeekDraft}
            cursorOffset={peekCursor}
            onCursorChange={setPeekCursor}
            onSubmit={handlePeekSubmit}
            onClose={handlePeekClose}
            columns={terminalWidth}
          />
        </Box>
      ) : null}
      {helpOpen ? (
        <Box marginTop={1}>
          <HelpOverlay
            focusedPinned={focusedJob?.state.pinned === true}
            canReorder={focused?.kind === 'job'}
            canRename={focused?.kind === 'job'}
            canPin={focused?.kind === 'job'}
            canMention={false}
            altOpenCount={0}
          />
        </Box>
      ) : null}
      <FleetFooter
        terminalWidth={terminalWidth}
        selectionKind={peekOpen ? 'job' : selectionKind}
        filterText={filterText}
        isCurrentSession={focusedJob?.state.sessionId === currentSessionId}
        isRenaming={false}
        isTransitional={false}
        isHeaderCollapsed={isHeaderCollapsed}
        jobEnterAction={peekOpen ? 'close' : 'open'}
        hasDeletableJobs={hasDeletableJobs}
        isArmedToDelete={armedDeleteId !== undefined}
        isGrouped={groupMode === 'directory'}
      />
    </Box>
  )
}

function rowKey(row: FleetRow, idx: number): string {
  if (row.kind === 'header') return `h:${row.group}`
  if (row.kind === 'fold') return `f:${row.group}`
  return `j:${row.job.id}:${idx}`
}

interface RowProps {
  row: FleetRow
  focused: boolean
  currentSessionId: string
  armedDeleteId: string | undefined
  terminalWidth: number
  labelWidth: number
  ageWidth: number
  collapsed: boolean
  prCache: FleetPrCache | undefined
}

function Row({
  row,
  focused,
  currentSessionId,
  armedDeleteId,
  terminalWidth,
  labelWidth,
  ageWidth,
  collapsed,
  prCache,
}: RowProps): React.ReactNode {
  if (row.kind === 'header') {
    return (
      <FleetSectionHeader
        label={row.label}
        rowCount={row.rowCount}
        collapsed={collapsed}
        focused={focused}
        width={terminalWidth}
      />
    )
  }
  if (row.kind === 'fold') {
    return (
      <Box paddingLeft={2}>
        <FleetSectionHeader
          label={`… ${row.hidden} more`}
          rowCount={row.hidden}
          collapsed={false}
          focused={focused}
          width={terminalWidth}
        />
      </Box>
    )
  }
  const isCurrent = row.job.state.sessionId === currentSessionId
  void prCache // child summaries derived in Phase 7 follow-up
  return (
    <FleetJobRow
      state={row.job.state}
      activity={row.activity}
      presence={undefined}
      isCurrentSession={isCurrent}
      focused={focused}
      attaching={false}
      deleteArmed={armedDeleteId === row.job.id ? { justKilled: false } : undefined}
      childSummaries={[]}
      age={formatJobAge(row.job)}
      labelWidth={labelWidth}
      ageWidth={ageWidth}
    />
  )
}
