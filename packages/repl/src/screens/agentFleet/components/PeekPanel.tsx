/**
 * Peek panel — full job summary + child rows + outputs + reply input.
 *
 * Source: ant 5092.js `gs3` (verbatim port). The panel renders a single
 * `<Box borderStyle="round" borderDimColor paddingX={1} minHeight={5}>`
 * containing a flexible vertical column. Below the box, the footer chord
 * cascade (`U_` in ant) is rendered as a sibling, NOT inside the box.
 *
 * Render sections (top to bottom inside the bordered box):
 *
 *   1. **Age + detail header** (`u_`) — renders ONLY when no children,
 *      no outputs, and no needs (`RH === false`). Shape:
 *         <Text color={tempoColor}>{age}</Text> {flatDetail}
 *      In our screenshot: "2h hi" — the dim trailing "hi" is the
 *      flattened state.detail (last assistant text via the worker's
 *      detail-summary writer). No template prefix, no second line.
 *
 *   2. **Children** (`c_`) — PR/issue/frame child rows. Each row:
 *      glyph (colored ●/◐) + truncated label + diffStat + status badges.
 *
 *   3. **Outputs** (`WH`) — named output sections. Filtered to skip any
 *      entry whose value already appears verbatim in a child label
 *      (avoids duplicating PR titles).
 *
 *   4. **Needs / Questions** (`CH`) — when `state.tempo==="blocked"`,
 *      shows `state.block.questions` as a structured prompt; otherwise
 *      `state.needs` as a flat wrap-text block.
 *
 *   5. Flex spacer (`__`) — pushes the reply input to the bottom of the
 *      bordered box even when the rest is sparse, hitting `minHeight=5`.
 *
 *   6. **Reply input** (`bH`) — single PromptInput-style text field.
 *
 *   7. **Reply error** (`j_`) — red dim-text below input on send failure.
 *
 * Below the box, ant renders `U_` — the footer chord cascade:
 *   reply empty + not bash:  "enter to resume · space to close · ctrl+x to delete"
 *   reply has text:          "enter to send · escape to close · ctrl+x to delete"
 *   renaming:                "enter to save · escape to cancel"
 *
 * Where "resume" vs "open" hinges on `qi8(state)` (needsRespawn).
 */

import type React from 'react'
import { useCallback, useState } from 'react'
import { Box, Text, type Theme } from '@anthropic/ink'

import type {
  FleetActivity,
  FleetJob,
  FleetPresence,
} from '@claude-code/agent/background/fleet/fleetTypes.js'
import TextInput from '../../../components/TextInput.js'

import { needsRespawn } from '../helpers/needsRespawn.js'
import { flattenDetail } from '../helpers/flattenDetail.js'
import { glyphColor } from '../helpers/glyphColor.js'
import {
  BlockedQuestionsPrompt,
  pickOptionLabelByKey,
} from './BlockedQuestionsPrompt.js'

export interface PeekPanelProps {
  /** Focused job — drives all summary/output/child rendering. */
  job: FleetJob
  /** Per-row activity rollup. Source: ant `q.activity` arg to Ti8. */
  activity?: FleetActivity
  /** Daemon roster presence. Source: ant `K` arg to Ti8 (status). */
  presence?: FleetPresence
  /** Current draft text. Caller owns state. */
  value: string
  /** Setter for the draft text. */
  onValueChange: (next: string) => void
  /** Cursor offset within the draft. */
  cursorOffset: number
  /** Setter for cursor offset. */
  onCursorChange: (offset: number) => void
  /** Submit handler — called with the trimmed draft (only when non-empty). */
  onSubmit: (text: string) => void
  /** Close handler — called on enter-on-empty (= resume/attach in ant). */
  onClose: () => void
  /** Resume / attach handler — fired by Enter on empty buffer (ant `z`). */
  onResume?: () => void
  /** Terminal column width for input wrapping. */
  columns: number
  /** Optional placeholder shown when value is empty. */
  placeholder?: string
  /** Recent reply error (rendered as `j_` below the input). */
  replyError?: string
}

/**
 * Age label from updatedAt. Source: ant gs3 `v = HK(L, {mostSignificantOnly:!0})`
 * — short relative timestamp like "1m", "2h", "3d".
 */
function formatAge(updatedAt: string): string {
  const ms = Math.max(0, Date.now() - Date.parse(updatedAt))
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

export function PeekPanel({
  job,
  activity,
  presence,
  value,
  onValueChange,
  cursorOffset,
  onCursorChange,
  onSubmit,
  onClose,
  onResume,
  columns,
  placeholder = 'reply',
  replyError,
}: PeekPanelProps): React.ReactNode {
  // Source: ant 5092.js gs3 mode state:
  //   let [C, m] = n8.useState(zG(I) === "bash" ? "bash" : "prompt")
  //   let F = C === "bash"
  // The `zG` predicate looks at the SAVED draft prefix — if it starts
  // with "!", the panel opens in bash mode. ccb's value prop is the
  // current draft, controlled by FleetView. We default to prompt mode
  // here; PeekPanel internally tracks bash mode via the ws_/backspace
  // handlers below.
  const [mode, setMode] = useState<'prompt' | 'bash'>(() =>
    value.startsWith('!') ? 'bash' : 'prompt',
  )
  const isBash = mode === 'bash'

  // Source: ant 5092.js gs3 zZ.onExit:
  //   onExit: () => {
  //     let e_ = o.current.trim();
  //     if (!e_ && p.current === "prompt") {
  //       E.current = true; z(); return;       // empty + prompt → attach
  //     }
  //     if (!e_) return;
  //     let L6 = dBH(e_, p.current);            // prepend "!" if bash
  //     ...send L6 as reply...
  //   }
  // ant uses dBH(text, mode) to format the submission: bash mode
  // prepends "!", prompt mode passes through. ccb's submit prepends
  // "!" when in bash mode, then passes to caller.
  const handleSubmit = useCallback(
    (submitted: string) => {
      const trimmed = submitted.trim()
      if (trimmed === '') {
        if (onResume !== undefined) onResume()
        else onClose()
        return
      }
      // Source: ant dBH (2451.js) — bash mode wraps with leading "!".
      const formatted = isBash ? `!${trimmed}` : trimmed
      onSubmit(formatted)
      // Reset mode after submit so the next peek opens in prompt.
      setMode('prompt')
    },
    [onClose, onResume, onSubmit, isBash],
  )

  const age = formatAge(job.state.updatedAt)
  // Source: ant gs3 `pH = Ti8(q.state, q.activity, K); {color: UH} = pH`.
  // UH drives age coloring across all sections (u_, WH, CH). Same Ti8
  // verbatim port lives in glyphColor.ts and FleetJobRow uses it.
  const { color: tempoColor } = glyphColor(job.state, activity, presence)
  const ageColor = tempoColor as keyof Theme | undefined

  // Children/outputs/needs presence — ant `RH = w.length>0 || KH.length>0
  // || !!q.state.needs`. When RH is false, render the "u_" header line.
  const children = job.state.children ?? []
  const allOutputs = Object.entries(job.state.output ?? {})
  // Drop outputs already covered by child labels (ant t = ...).
  const childLabels = children
    .filter(c => c.label !== undefined)
    .map(c => c.label as string)
  const outputs = allOutputs.filter(([, v]) => {
    return !childLabels.some(label => {
      const idx = v.indexOf(label)
      return (
        idx >= 0 &&
        !/\w/.test(v[idx + label.length] ?? '') &&
        v.length - label.length < 16
      )
    })
  })
  const hasNeeds = job.state.needs !== undefined && job.state.needs !== ''
  const RH = children.length > 0 || outputs.length > 0 || hasNeeds

  // Footer chord — ant `U_`.
  //   reply text non-empty             → "enter to send · escape to close · ctrl+x to delete"
  //   reply text empty + needs respawn → "enter to resume · space to close · ctrl+x to delete"
  //   reply text empty + alive         → "enter to open · space to close · ctrl+x to delete"
  const hasReply = value.trim() !== ''
  const enterChord = hasReply
    ? 'enter to send'
    : needsRespawn(job)
      ? 'enter to resume'
      : 'enter to open'
  const closeChord = hasReply ? 'escape to close' : 'space to close'

  return (
    <Box flexDirection="column">
      {/* The bordered peek box. ant `w_` = root <Box ...>{u_, c_, WH, CH, __, bH, j_}</Box>.
          ant gs3:
            T_ = F ? "bashBorder" : void 0       // borderColor
            H_ = !F                                // borderDimColor
          In bash mode the box gets a colored bashBorder; otherwise the
          border is dim. */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={isBash ? 'bashBorder' : undefined}
        borderDimColor={!isBash}
        paddingX={1}
        minHeight={5}
        width="100%"
      >
        {/* (1) u_ — age + flat-detail header. Only when RH=false. */}
        {!RH ? (
          <Box maxHeight={5} overflowY="hidden">
            <Text wrap="wrap">
              <Text color={ageColor}>{age}</Text>
              {job.state.detail !== undefined && job.state.detail !== '' ? (
                <Text> {flattenDetail(job.state.detail)}</Text>
              ) : null}
            </Text>
          </Box>
        ) : null}

        {/* (2) c_ — child PR/frame rows. Source: ant gs3:
              gH.map(e_ => <B key=e_.row.href>
                <B width={rH} flexShrink={0}>
                  {e_.color && <V color={e_.color}>{myH(e_) ? tq_ : Q4}</V>}
                </B>
                <B flexGrow={1} width={0}>
                  <V wrap="truncate"><sq url={e_.row.href}>{e_.label}</sq></V>
                </B>
                ...diffStat + status badges
              </B>)
            where:
              Q4  = '⏺' (●, macos) or '○' (○)
              tq_ = '⧉' (⧉, frame join glyph)
              myH(e) = e.row.kind === "frame"
            ccb's FleetChildSummary carries kind + href; label/color/diff/
            status enrichment requires the PR cache integration in
            FleetView (deriveChildSummaries) — TODO to plumb through.
            For now port the glyph distinction so frames vs PR children
            are visually distinguishable. */}
        {children.length > 0 ? (
          <Box flexDirection="column">
            {children.slice(0, 8).map(child => {
              // Source: ant 0665.js `Q4 = d_() === "macos" ? "⏺" : "●"`,
              // 0664.js `tq_ = "⧉"`. macOS terminals render ⏺ at a
              // slightly larger weight that better matches the surrounding
              // glyph palette; ● is the cross-platform default.
              const Q4 = process.platform === 'darwin' ? '⏺' : '●'
              const glyph = child.kind === 'frame' ? '⧉' : Q4
              return (
                <Box key={child.href}>
                  <Box width={2} flexShrink={0}>
                    <Text dimColor>{glyph}</Text>
                  </Box>
                  <Box flexGrow={1} width={0}>
                    <Text wrap="truncate">{child.label ?? child.href}</Text>
                  </Box>
                </Box>
              )
            })}
            {children.length > 8 ? (
              <Box paddingLeft={2}>
                <Text dimColor>… {children.length - 8} more</Text>
              </Box>
            ) : null}
          </Box>
        ) : null}

        {/* (3) WH — named outputs (filtered). */}
        {outputs.length > 0 ? (
          <Box flexDirection="column" marginTop={children.length > 0 ? 1 : 0}>
            {outputs.map(([name, text]) => (
              <Box key={name}>
                {outputs.length > 1 ? (
                  <Box flexShrink={0} paddingRight={1}>
                    <Text dimColor>{name}</Text>
                  </Box>
                ) : null}
                <Box flexGrow={1} width={0} maxHeight={5} overflowY="hidden">
                  <Text wrap="wrap">
                    <Text color={ageColor}>{age}</Text> {flattenDetail(text)}
                  </Text>
                </Box>
              </Box>
            ))}
          </Box>
        ) : null}

        {/* (4) CH — needs / questions. Source: ant gs3 (5092.js):
              YH = state.tempo === "blocked" ? state.block?.questions : undefined
              CH = YH ? <B marginTop=...><KdK questions={YH} ageLabel={v} ageColor={UH}/></B>
                 : state.needs ? <B marginTop=... maxHeight overflowY="hidden">
                                   <V wrap="wrap">{age} {flattenDetail(needs)}</V>
                                 </B>
                 : null
            Structured questions take priority over flat needs.  */}
        {job.state.tempo === 'blocked' &&
        job.state.block?.questions !== undefined &&
        job.state.block.questions.length > 0 ? (
          <Box marginTop={children.length > 0 || outputs.length > 0 ? 1 : 0}>
            <BlockedQuestionsPrompt
              questions={job.state.block.questions}
              ageLabel={age}
              ageColor={ageColor}
            />
          </Box>
        ) : hasNeeds ? (
          <Box
            marginTop={children.length > 0 || outputs.length > 0 ? 1 : 0}
            maxHeight={5}
            overflowY="hidden"
          >
            <Text wrap="wrap">
              <Text color={ageColor}>{age}</Text>{' '}
              <Text>{flattenDetail(job.state.needs ?? '')}</Text>
            </Text>
          </Box>
        ) : null}

        {/* (5) flex spacer — fills bordered box to minHeight=5. */}
        <Box flexGrow={1} />

        {/* (6) bH — reply input. Source: ant gs3 PN render:
              prefix       = F ? "!" : sH.pointer    // ❯ (U+276F)
              prefixColor  = F ? "bashBorder" : void 0
              prefixDim    = !LH                     // dim when Q.trim() empty
              placeholder  = "reply" (default, blocked uses suggestedReply)
              borderless   = true
              isFocused    = !M (not renaming)
            ant 4205.js PN:
              prefix renders inside V with {color, dimColor}
              query/placeholder renders with cursor (uj3 inline highlight
              when query has content, inverse char when empty placeholder).
            ccb doesn't have bash mode wired yet so prefix is always
            sH.pointer (❯). Cursor visibility relies on focus + showCursor
            which TextInput already handles for non-empty buffers; for empty
            buffer the placeholder shows dim, with the inverse first-char
            acting as cursor. */}
        <Box marginTop={1}>
          {/* Source: ant 5092.js gs3 PN render:
                a = F ? "!" : sH.pointer                    // prefix char
                OH = F ? "bashBorder" : void 0              // prefixColor
                IH = !LH                                     // prefixDim
              Bash mode renders "!" prefix in bashBorder color. */}
          <Text
            color={isBash ? 'bashBorder' : undefined}
            dimColor={value.trim() === ''}
          >
            {isBash ? '! ' : '❯ '}
          </Text>
          <TextInput
            value={value}
            onChange={onValueChange}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={onCursorChange}
            onSubmit={handleSubmit}
            // Source: ant gs3: `onSpaceOnEmpty: F ? void 0 : $`. Bash
            // mode disables space-close so space inserts normally.
            onSpaceOnEmpty={isBash ? undefined : onClose}
            // Source: ant 5092.js gs3 OdK branch — only fires in prompt
            // mode (`p.current === "prompt"`).
            onNumberKeyOnEmpty={
              isBash
                ? undefined
                : key => pickOptionLabelByKey(key, job.state.block?.questions)
            }
            // Source: ant 5092.js gs3 l_ — right-arrow attach only in
            // prompt mode.
            onRightArrowOnEmpty={isBash ? undefined : (onResume ?? onClose)}
            // Source: ant 5092.js gs3 l_:
            //   if (ws_(e_.key) && !o.current) { x("bash"); return; }
            // "!" on empty prompt buffer enters bash mode.
            onExclamationOnEmpty={isBash ? undefined : () => setMode('bash')}
            // Source: ant 5092.js gs3 l_:
            //   else if (e_.name === "backspace" && !o.current) {
            //     x("prompt"); return;
            //   }
            // Backspace on empty bash buffer exits bash mode.
            onBackspaceOnEmpty={isBash ? () => setMode('prompt') : undefined}
            placeholder={placeholder}
            focus={true}
            showCursor={true}
            multiline={true}
            columns={Math.max(columns - 6, 20)}
          />
        </Box>

        {/* (7) j_ — reply error. */}
        {replyError !== undefined && replyError !== '' ? (
          <Box>
            <Text color="error" dimColor wrap="truncate">
              {replyError}
            </Text>
          </Box>
        ) : null}
      </Box>

      {/* U_ — footer chord cascade rendered OUTSIDE the box, paddingLeft=2. */}
      <Box paddingLeft={2}>
        <Text dimColor>
          {enterChord} · {closeChord} · ctrl+x to delete
        </Text>
      </Box>
    </Box>
  )
}
