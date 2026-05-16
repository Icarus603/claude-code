/**
 * Single job row layout.
 *
 * Source: ant row rendering (5092.js:1380-1610).
 *
 *   ┌──────┬───────────────┬─────────────────────────────────────────┬─────┐
 *   │glyph │ label          │ middle activity (truncate)              │ Nm  │
 *   └──────┴───────────────┴─────────────────────────────────────────┴─────┘
 *      2      e=label+2         flexGrow=1, paddingLeft=2              age
 *
 * The glyph cell shows either:
 *   - `<FleetSpinner>` (animated, when in the active band)
 *   - a static character from pickIcon (✻ steady, ✢ completed, ∙ pinned-idle)
 *   - nothing when presence==="busy"|"shell" (the row body fills out)
 *
 * The label cell renders three exclusive variants:
 *   1. **Color badge** — when state.color is set (subagent palette) — uses
 *      Xw (ccb's TeammateChip-style colored chip).
 *   2. **Inline rename buffer** — when `renaming` is active.
 *   3. **Typing animation frame** — when `Ms3` returned non-null (mid label-
 *      replace tween).
 *   4. **Plain label** with optional hyperlink to `output.result`.
 *
 * The middle cell shows:
 *   - "opening…" while attaching
 *   - "ctrl+x again to delete" / "stopped · ctrl+x again to delete" when
 *     armed for delete
 *   - the activity text + optional `× N` loop-kick count
 *
 * The right cell shows the formatted elapsed age (or `→ to return` glyph
 * for the foreground row, prefixed with detail when E is set).
 */

import { Box, Text } from '@anthropic/ink'
import figures from 'figures'

import {
  AGENT_COLORS,
  AGENT_COLOR_TO_THEME_COLOR,
  type AgentColorName,
} from '@claude-code/tool-registry/tools/AgentTool/agentColorManager.js'
import type {
  FleetActivity,
  FleetJobState,
  FleetPresence,
} from '@claude-code/agent/background/fleet/fleetTypes.js'

import { flattenDetail } from '../helpers/flattenDetail.js'
import { glyphColor } from '../helpers/glyphColor.js'
import { jobLabel } from '../helpers/jobLabel.js'
import { pickIcon } from '../helpers/pickIcon.js'
import { stateOutcome } from '../helpers/stateOutcome.js'
import { FleetSpinner } from './FleetSpinner.js'

/** Loosened activity to allow undefined for transient rows. */
type ActivityOrPending = FleetActivity | undefined

export interface FleetRowChildSummary {
  /** Hex/named color for the child rollup glyph (or undefined to suppress). */
  color?: string
  href: string
  kind: 'agent' | 'frame'
}

export interface FleetJobRowProps {
  state: FleetJobState
  activity: ActivityOrPending
  presence: FleetPresence
  /** True when this row is the user's foreground session. */
  isCurrentSession: boolean
  /** Whether the row is currently the focused list item. */
  focused: boolean
  /** True when the row is in attach (opening) state. */
  attaching: boolean
  /** Armed-delete payload — `{justKilled: bool}` when ctrl+x was hit once. */
  deleteArmed?: { justKilled: boolean }
  /** Mid-typing rename state — `{draft, cursor}` while user is editing the name. */
  renaming?: { draft: string; cursor: number }
  /** Optional typing-anim frame from labelReplaceAnim. */
  typingFrame?: { display: string; newLen: number }
  /** Direct child summaries used for the right-side rollup glyph. */
  childSummaries: readonly FleetRowChildSummary[]
  /** Loop-kick count, displayed as `× N` suffix when > 0. */
  loopKickCount?: number
  /** Pre-formatted age string ("3m", "in 1h", etc). */
  age: string
  /** Width of the label cell (computed per-list to align rows). */
  labelWidth: number
  /** Width of the age cell. */
  ageWidth: number
}

function colorBadgeStyleFor(
  color: string | undefined,
): { theme: string } | undefined {
  if (color === undefined) return undefined
  if (!(AGENT_COLORS as readonly string[]).includes(color)) return undefined
  return { theme: AGENT_COLOR_TO_THEME_COLOR[color as AgentColorName] }
}

function pickRowGlyph(
  state: FleetJobState,
  presence: FleetPresence,
  attaching: boolean,
  deleteArmed: { justKilled: boolean } | undefined,
  outcome: ReturnType<typeof stateOutcome>,
): { glyph: string | null; isAnimated: boolean } {
  if (attaching) return { glyph: null, isAnimated: false }
  if (deleteArmed?.justKilled === true) return { glyph: '∙', isAnimated: false }
  const isPinned = state.pinned === true
  const staticGlyph = pickIcon(state, isPinned, presence)
  if (staticGlyph !== null) return { glyph: staticGlyph, isAnimated: false }
  // outcome === null means it's still running — animate
  if (outcome === null) return { glyph: null, isAnimated: true }
  return { glyph: null, isAnimated: false }
}

/** Source: ant row rendering (5092.js:1380-1610). */
export function FleetJobRow(props: FleetJobRowProps): JSX.Element {
  const {
    state,
    activity,
    presence,
    isCurrentSession,
    focused,
    attaching,
    deleteArmed,
    renaming,
    typingFrame,
    childSummaries,
    loopKickCount,
    age,
    labelWidth,
    ageWidth,
  } = props

  const outcome = stateOutcome(state.state)
  const { color: glyphCol, dim: glyphDim } = glyphColor(state, activity, presence)

  const { glyph, isAnimated } = pickRowGlyph(state, presence, attaching, deleteArmed, outcome)

  const label = jobLabel(state, isCurrentSession)
  const badge = colorBadgeStyleFor(state.color)

  const middleText = pickMiddleText({
    state,
    activity,
    presence,
    isCurrentSession,
    focused,
  })

  return (
    <Box width={focused ? undefined : undefined}>
      {/* glyph column — width = labelWidth.glyph (2 cells) */}
      <Box width={2} flexShrink={0}>
        {isAnimated ? (
          <FleetSpinner color={glyphCol} dim={glyphDim} />
        ) : (
          <Text color={glyphCol} dimColor={glyphDim}>
            {glyph ?? ' '}
          </Text>
        )}
      </Box>

      {/* label column */}
      <Box width={labelWidth} flexShrink={0}>
        <LabelCell
          label={label}
          renaming={renaming}
          typingFrame={typingFrame}
          badge={badge}
          focused={focused}
        />
      </Box>

      {/* middle activity column */}
      <Box flexGrow={1} width={0} paddingLeft={2}>
        {attaching ? (
          <Text dimColor wrap="truncate">opening…</Text>
        ) : deleteArmed !== undefined ? (
          <Text color="error" wrap="truncate">
            {deleteArmed.justKilled ? 'stopped · ctrl+x again to delete' : 'ctrl+x again to delete'}
          </Text>
        ) : (
          <Text dimColor wrap="truncate">
            {middleText}
            {loopKickCount !== undefined && loopKickCount > 0 ? ` ×${loopKickCount}` : ''}
          </Text>
        )}
      </Box>

      {/* right-side PR/frame rollup */}
      <ChildRollup summaries={childSummaries} />

      {/* age column */}
      <Box width={ageWidth} flexShrink={0} justifyContent="flex-end">
        <Text dimColor>{age}</Text>
      </Box>
    </Box>
  )
}

interface LabelCellProps {
  label: string
  renaming?: { draft: string; cursor: number }
  typingFrame?: { display: string; newLen: number }
  badge?: { theme: string }
  focused: boolean
}

function LabelCell({ label, renaming, typingFrame, badge, focused }: LabelCellProps): JSX.Element {
  if (renaming !== undefined) {
    return <RenameInput draft={renaming.draft} cursor={renaming.cursor} />
  }
  if (badge !== undefined && renaming === undefined) {
    return (
      <Text color={badge.theme} bold={focused}>
        {label}
      </Text>
    )
  }
  if (typingFrame !== undefined) {
    return (
      <>
        <Text dimColor={!focused}>{typingFrame.display.slice(0, typingFrame.newLen)}</Text>
        <Text dimColor>{typingFrame.display.slice(typingFrame.newLen)}</Text>
      </>
    )
  }
  return <Text dimColor={!focused}>{label}</Text>
}

interface RenameInputProps {
  draft: string
  cursor: number
}

/**
 * Inline-rename buffer renderer — shows the draft with a block cursor at
 * `cursor` offset. Source: ant `is3` helper (5092.js, inline draft writer).
 */
function RenameInput({ draft, cursor }: RenameInputProps): JSX.Element {
  const before = draft.slice(0, cursor)
  const at = draft.slice(cursor, cursor + 1) || ' '
  const after = draft.slice(cursor + 1)
  return (
    <>
      <Text>{before}</Text>
      <Text inverse>{at}</Text>
      <Text>{after}</Text>
    </>
  )
}

interface MiddlePickArgs {
  state: FleetJobState
  activity: ActivityOrPending
  presence: FleetPresence
  isCurrentSession: boolean
  focused: boolean
}

/**
 * Build the middle-column text. Source: ant 5092.js:1434-1473.
 *
 *   - foreground session: `<detail> · →`  or  `→ to return`
 *   - success: trimmed `output.result` or `detail`
 *   - active: `detail`
 *   - blocked: `needs` or `detail`
 */
function pickMiddleText({
  state,
  activity,
  presence,
  isCurrentSession,
  focused,
}: MiddlePickArgs): string {
  const outcome = stateOutcome(state.state)
  const arrowRight = figures.arrowRight

  if (focused && isCurrentSession) {
    const detail =
      state.tempo === 'blocked'
        ? state.needs
        : outcome === 'failure'
          ? state.detail
          : undefined
    if (detail !== undefined && detail !== '') {
      return `${flattenDetail(detail)} · ${arrowRight}`
    }
    return `${arrowRight} to return`
  }

  const resultText = state.output?.result
  if (outcome === 'success') {
    return flattenDetail(resultText !== undefined && resultText !== '' ? resultText : state.detail)
  }

  if (state.tempo === 'active') {
    const v = activity !== 'success' && state.detail ? state.detail : ''
    return flattenDetail(v)
  }

  const blockedDetail = state.tempo === 'blocked' && state.needs ? state.needs : state.detail
  // suppress presence-only mention since unused in this branch
  void presence
  return flattenDetail(blockedDetail)
}

interface ChildRollupProps {
  summaries: readonly FleetRowChildSummary[]
}

/**
 * Right-side rollup glyph for child PRs / frames. Source: ant 5092.js:1595-1610.
 *
 * Picks the strongest-color child as the representative, shows count if
 * multiple, falls through to a "claude" colored frame glyph for frame
 * children when no PR is rollable.
 */
function ChildRollup({ summaries }: ChildRollupProps): JSX.Element | null {
  const colorable = summaries.filter(s => s.color !== undefined)
  const frames = summaries.filter(s => s.kind === 'frame')
  if (colorable.length === 0 && frames.length === 0) return null

  const first = colorable[0]
  if (first !== undefined) {
    const count = colorable.length
    return (
      <Box flexShrink={0}>
        <Text color={first.color}>{count > 1 ? `${count} ` : ''}●</Text>
        <Text> </Text>
      </Box>
    )
  }
  const lastFrame = frames[frames.length - 1]
  if (lastFrame !== undefined) {
    return (
      <Box flexShrink={0}>
        <Text color="cyan">{frames.length > 1 ? `${frames.length} ` : ''}◐</Text>
        <Text>  </Text>
      </Box>
    )
  }
  return null
}
