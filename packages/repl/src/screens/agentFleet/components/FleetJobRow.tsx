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

import type React from 'react'
import { Box, Link, Text } from '@anthropic/ink'
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
import { resolveResultUrl } from '../helpers/resultUrl.js'
import { useLabelReplaceAnim } from '../hooks/useLabelReplaceAnim.js'
import { pickIcon } from '../helpers/pickIcon.js'
import { stateOutcome } from '../helpers/stateOutcome.js'
import { FleetSpinner } from './FleetSpinner.js'

/** Loosened activity to allow undefined for transient rows. */
type ActivityOrPending = FleetActivity | undefined

export interface FleetRowChildSummary {
  /** Theme color key for the child rollup glyph (or undefined to suppress). */
  color?: keyof import('@anthropic/ink').Theme
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
): { theme: keyof import('@anthropic/ink').Theme } | undefined {
  if (color === undefined) return undefined
  if (!(AGENT_COLORS as readonly string[]).includes(color)) return undefined
  return { theme: AGENT_COLOR_TO_THEME_COLOR[color as AgentColorName] }
}

/**
 * Source: ant rs3 glyph branch (5092.js):
 *   P = D ? void 0 : J?.justKilled ? sq_ : pdK(q.state, X, $)
 *   s = P ?? <Cs3/>          // null from pdK → animated spinner
 *
 * where X = bZH(state.state) (terminal outcome | null), $ = presence.
 * pdK returning null is the ONLY animation trigger — it returns null
 * only when presence is "busy" or "shell".
 */
function pickRowGlyph(
  state: FleetJobState,
  presence: FleetPresence,
  attaching: boolean,
  deleteArmed: { justKilled: boolean } | undefined,
  outcome: ReturnType<typeof stateOutcome>,
): { glyph: string | null; isAnimated: boolean } {
  if (attaching) return { glyph: null, isAnimated: false }
  if (deleteArmed?.justKilled === true) return { glyph: '∙', isAnimated: false }
  const staticGlyph = pickIcon(state, outcome, presence)
  if (staticGlyph !== null) return { glyph: staticGlyph, isAnimated: false }
  // pickIcon returned null → presence is busy/shell → animate. ant
  // doesn't gate this on outcome — busy presence wins regardless.
  return { glyph: null, isAnimated: true }
}

/** Source: ant row rendering (5092.js:1380-1610). */
export function FleetJobRow(props: FleetJobRowProps): React.ReactNode {
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
  const { color: glyphColorKey, dim: glyphDim } = glyphColor(state, activity, presence)
  const glyphCol = glyphColorKey as keyof import('@anthropic/ink').Theme | undefined

  const { glyph, isAnimated } = pickRowGlyph(state, presence, attaching, deleteArmed, outcome)

  const label = jobLabel(state, isCurrentSession)
  // ant 5092.js `Ms3` — animate ONLY on the first transition from "no
  // name" to "has name" (auto-name after first turn). Caller's
  // typingFrame prop (if any) wins; in practice nobody passes it
  // externally, so the hook owns the anim.
  const hasName = state.name !== undefined && state.name !== ''
  const internalTypingFrame = useLabelReplaceAnim(label, hasName)
  const effectiveTypingFrame = typingFrame ?? internalTypingFrame
  const badge = colorBadgeStyleFor(state.color)
  // ant 5092.js rs3 LabelCell: `L = xs3(state.output?.result)`. When set,
  // the label becomes an OSC 8 hyperlink — clicking opens the URL/path
  // via FleetView's onHyperlinkClick handler (openBrowser / openPath).
  const resultUrl = resolveResultUrl(state.output?.result)

  const middleText = pickMiddleText({
    state,
    activity,
    presence,
    isCurrentSession,
    focused,
  })

  return (
    <Box backgroundColor={focused ? 'userMessageBackground' : undefined}>
      {/* glyph column — width = labelWidth.glyph (2 cells).
          Source: ant 5092.js rs3:
            wH = N_.createElement(V, {color: M, dimColor: o}, s)
          The SAME (color, dim) wrapper applies to both the static glyph
          and the Cs3 spinner — derived from Ti8(state, activity,
          presence). For busy presence Ti8 returns {color:undefined,
          dim:false} so the spinner renders uncolored, NOT brand color.
          ccb previously hardcoded 'claude' for the spinner; reverted to
          ant verbatim so the spinner shares the row's tempo color. */}
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
          typingFrame={effectiveTypingFrame}
          badge={badge}
          focused={focused}
          resultUrl={resultUrl}
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
  badge?: { theme: keyof import('@anthropic/ink').Theme }
  focused: boolean
  /** OSC 8 URL the label should hyperlink to. ant rs3 wraps the label
   *  in `<sq url={L}>` when state.output.result resolves to a URL. */
  resultUrl?: string | null
}

function LabelCell({
  label,
  renaming,
  typingFrame,
  badge,
  focused,
  resultUrl,
}: LabelCellProps): React.ReactNode {
  if (renaming !== undefined) {
    return <RenameInput draft={renaming.draft} cursor={renaming.cursor} />
  }
  if (badge !== undefined && renaming === undefined) {
    // Source: ant rs3 — `<Xw color={p} bold={focused} padded>{L?<sq url=L>{m}</sq>:m}</Xw>`.
    // Hyperlink only wraps the LABEL inside the colored chip.
    return (
      <Text color={badge.theme} bold={focused}>
        {resultUrl ? <Link url={resultUrl}>{label}</Link> : label}
      </Text>
    )
  }
  if (typingFrame !== undefined) {
    // Mid-anim — don't hyperlink (text is transient, click would target
    // a confusing partial label). Source: ant rs3 branches typingFrame
    // BEFORE the L fallback.
    return (
      <>
        <Text dimColor={!focused}>{typingFrame.display.slice(0, typingFrame.newLen)}</Text>
        <Text dimColor>{typingFrame.display.slice(typingFrame.newLen)}</Text>
      </>
    )
  }
  // ant rs3 plain-label branch: `L ? <sq url=L>{m}</sq> : m`.
  return (
    <Text dimColor={!focused}>
      {resultUrl ? <Link url={resultUrl}>{label}</Link> : label}
    </Text>
  )
}

interface RenameInputProps {
  draft: string
  cursor: number
}

/**
 * Inline-rename buffer renderer — shows the draft with a block cursor at
 * `cursor` offset. Source: ant `is3` helper (5092.js, inline draft writer).
 */
function RenameInput({ draft, cursor }: RenameInputProps): React.ReactNode {
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
function ChildRollup({ summaries }: ChildRollupProps): React.ReactNode | null {
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
        <Text color="cyan_FOR_SUBAGENTS_ONLY">{frames.length > 1 ? `${frames.length} ` : ''}◐</Text>
        <Text>  </Text>
      </Box>
    )
  }
  return null
}
