/**
 * FleetView footer chord-hint bar.
 *
 * Source: ant 5092.js:3478-3533 — the 7-branch chord cascade rendered
 * below the main list when no overlay is active and the alert queue is
 * empty.
 *
 * Render order (left to right, each conditional):
 *   1. Defaults indicator               (when `defaultsApplied` populated)
 *   2. `enter` chord with action open/close
 *      (when selection is a job & not renaming, OR a session-shortcut
 *       is selected & not in a transitional state)
 *   3. `enter` chord with action expand/collapse
 *      (when selection is a header & filter is empty)
 *   4. `enter` chord with action "show all"
 *      (when selection is a fold row & filter is empty)
 *   5. `space` chord with action "reply"
 *      (when selection is a job, filter is empty, terminal ≥55 cols)
 *   6. `ctrl+x` chord with action delete OR "delete all" (terminal ≥80)
 *   7. `escape` chord with action clear (when filter buffer is non-empty)
 *   8. "? for shortcuts" hint (when filter buffer is empty)
 *
 * Source maps directly to the screenshots:
 *   row focused, idle:   "enter to open · space to reply · ctrl+x to delete · ? for shortcuts"
 *   header focused open: "enter to collapse · ctrl+x to delete all · ? for shortcuts"
 *   header focused fold: "enter to expand · ctrl+x to delete all · ? for shortcuts"
 *   reply mode:          "enter to open · space to close · ctrl+x to delete"
 *                        (caller passes a different shape — see PeekPanel)
 *
 * tH = the chord renderer (renders `enter to open` / `space to reply`
 * etc with keycap formatting). For ccb we render plainly inline.
 */

import type React from 'react'
import { Text } from '@anthropic/ink'

export type FleetFooterSelectionKind = 'job' | 'header' | 'fold' | 'none'

export interface FleetFooterProps {
  /** Width of the terminal (drives the ≥55 / ≥80 col gates). */
  terminalWidth: number
  /** What sort of row is currently focused. */
  selectionKind: FleetFooterSelectionKind
  /** Filter-bar input text — empty when the user is just navigating. */
  filterText: string
  /** Whether the current job-row selection points at the foreground session. */
  isCurrentSession: boolean
  /** Whether the focused row is in inline-rename mode (suppresses open chord). */
  isRenaming: boolean
  /** Whether the focused row is in transitional state (suppresses open chord). */
  isTransitional: boolean
  /** Whether the focused header's section is currently collapsed. */
  isHeaderCollapsed: boolean
  /**
   * Label for the `enter` chord on jobs. Source: ant 5092.js `_h`:
   *   _h = S$ ? "create" : (E9 && qi8(E9.state)) ? "resume" : "open"
   * - "create" when the buffer parses to a new-job dispatch
   * - "resume" when the focused job is failed/stopped (needs respawn)
   * - "open"   default — attach to a running session
   * - "close"  in peek mode (Enter closes the peek panel)
   */
  jobEnterAction: 'open' | 'close' | 'resume' | 'create'
  /** True when any non-empty deletable queue exists (ant `qh.length > 0`). */
  hasDeletableJobs: boolean
  /** True when the focused row is in "armed to delete" state (RJ). */
  isArmedToDelete: boolean
  /** When the section is "ungrouped state buckets" the delete-all hint is suppressed. */
  isGrouped: boolean
  /** Optional defaults indicator (e.g. "max effort"). When set, rendered first. */
  defaultsHint?: string
}

interface ChordProps {
  chord: string
  action: string
  bold?: boolean
}

function Chord({ chord, action, bold }: ChordProps): React.ReactNode {
  return (
    <Text bold={bold}>
      {chord} to {action}
    </Text>
  )
}

/** Source: ant footer cascade (5092.js:3478-3533). */
export function FleetFooter(props: FleetFooterProps): React.ReactNode | null {
  const {
    terminalWidth,
    selectionKind,
    filterText,
    isRenaming,
    isTransitional,
    isHeaderCollapsed,
    jobEnterAction,
    hasDeletableJobs,
    isArmedToDelete,
    isGrouped,
    defaultsHint,
  } = props

  const filterEmpty = filterText === ''
  const isJob = selectionKind === 'job'
  const isHeader = selectionKind === 'header'
  const isFold = selectionKind === 'fold'

  const chords: React.ReactNode[] = []

  if (defaultsHint !== undefined && defaultsHint !== '') {
    chords.push(<Text key="defaults">{defaultsHint}</Text>)
  }

  // 1. enter open/close — job selection
  if (isJob && !isRenaming && !isTransitional) {
    chords.push(<Chord key="enter-job" chord="enter" action={jobEnterAction} />)
  }

  // 2. enter expand/collapse — header selection
  if (isHeader && filterEmpty) {
    chords.push(
      <Chord
        key="enter-header"
        chord="enter"
        action={isHeaderCollapsed ? 'expand' : 'collapse'}
      />,
    )
  }

  // 3. enter show all — fold selection
  if (isFold && filterEmpty) {
    chords.push(<Chord key="enter-fold" chord="enter" action="show all" />)
  }

  // 4. space reply — job + ≥55 cols
  if (isJob && filterEmpty && terminalWidth >= 55) {
    chords.push(<Chord key="space-reply" chord="space" action="reply" />)
  }

  // 5. ctrl+x delete / delete all — ≥80 cols
  if (terminalWidth >= 80) {
    if (isJob && !isArmedToDelete && filterEmpty) {
      chords.push(<Chord key="ctrlx-delete" chord="ctrl+x" action="delete" />)
    } else if (!isGrouped && hasDeletableJobs) {
      chords.push(<Chord key="ctrlx-delete-all" chord="ctrl+x" action="delete all" />)
    }
  }

  // 6. escape clear — when filter buffer is dirty
  if (filterText !== '') {
    chords.push(<Chord key="escape-clear" chord="escape" action="clear" />)
  }

  // 7. ? for shortcuts — when filter is empty
  if (filterEmpty) {
    chords.push(<Text key="help">? for shortcuts</Text>)
  }

  if (chords.length === 0) return null

  return (
    <Text dimColor>
      <FooterJoin>{chords}</FooterJoin>
    </Text>
  )
}

/**
 * Join chord children with " · " separators (ant `K6` join helper).
 */
function FooterJoin({ children }: { children: React.ReactNode[] }): React.ReactNode {
  const out: (React.ReactNode | string)[] = []
  for (let i = 0; i < children.length; i++) {
    if (i > 0) out.push(' · ')
    out.push(children[i])
  }
  return <>{out}</>
}
