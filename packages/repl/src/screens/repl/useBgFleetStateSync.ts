/**
 * Bridge a bg session's runtime activity into the on-disk state.json
 * that FleetView polls.
 *
 * ccb's bg worker has no daemon supervisor (unlike ant, which uses
 * 4835.js WorkerVm + 3988.js text inference to update state.json on
 * every assistant turn). Without these, the disk state never advances
 * past the seed `state: 'working'` / `tempo: 'active'` written by
 * spawnBgPty — so FleetView's "Working" count never decrements when
 * the assistant finishes, and the row never moves to the Completed
 * bucket.
 *
 * Driven by `isLoading` + the last assistant message. Lifecycle:
 *
 *   mount (isLoading=true):       state=working, tempo=active
 *   turn complete (true→false):
 *     - assistant asked a question  → state=working, tempo=blocked, needs=question
 *     - "failed" / "giving up" text → state=failed,  tempo=idle
 *     - everything else             → state=done,    tempo=idle
 *   new user message (false→true): state=working, tempo=active
 *
 * The patterns mirror ant 3988.js — the inference engine that scans
 * assistant output for state markers:
 *   - result-marker / ready-for / pushed-committed → state=done
 *   - blocked-marker / `?` at end                  → state=blocked
 *   - giving-up                                    → state=failed
 *
 * Gated on `CLAUDE_CODE_SESSION_KIND === 'bg'` AND `CLAUDE_JOB_DIR`
 * being set — both written by spawnPty so the foreground REPL is
 * unaffected.
 */

import { useEffect, useRef } from 'react'
import type { MessageType } from '@claude-code/agent/messages.js'
import {
  readJobState,
  writeJobState,
  invalidateCache,
} from '@claude-code/agent/background/fleet/fleetStore.js'
import { generateJobName } from '@claude-code/agent/background/fleet/generateJobName.js'
import { basename } from 'node:path'

/**
 * Compress assistant text into a single-line FleetView middle-column
 * snippet. ant 3988.js leans on the LLM classifier to produce a 1-line
 * `detail` (typically ≤80 chars) and store it as both `detail` and
 * `output.result`; without an LLM in ccb's in-worker path we approximate
 * by stripping markdown, picking the last sentence, then hard-clamping
 * to MAX. ant's row Text wraps the whole line in `<Text wrap="truncate">`
 * so the column itself enforces a visible cap; the MAX here mirrors
 * ant's `xf=80` (5092.js detail truncation) so an overly long reply
 * doesn't blow past the column and force ellipsis on every screen.
 */
const FLEET_DETAIL_MAX = 80
function flattenAssistantReply(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const noFences = trimmed.replace(/```[\s\S]*?```/g, ' ')
  const flat = noFences
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return ''
  const sentences = flat.match(/[^.!?。！？]+[.!?。！？]/g) ?? [flat]
  const pick = (sentences.at(-1) ?? flat).trim()
  return pick.length > maxChars ? `${pick.slice(0, maxChars - 1)}…` : pick
}

/**
 * Pull the text of the last assistant message in the conversation. Used
 * by the text-inference path to decide whether the turn ended on a
 * question, a failure, or a normal completion.
 */
function lastAssistantText(messages: readonly MessageType[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.type === 'assistant' && 'message' in m) {
      const content = m.message?.content
      if (Array.isArray(content)) {
        for (let j = content.length - 1; j >= 0; j--) {
          const block = content[j] as { type?: string; text?: unknown }
          if (block?.type === 'text' && typeof block.text === 'string') {
            return block.text
          }
        }
      }
    }
  }
  return ''
}

/**
 * Simplified port of ant 3988.js inference branches.
 *
 *   ?-at-end OR "question:" OR "need more"          → 'blocked'
 *   "giving up" / "I can't" / explicit failure      → 'failed'
 *   default                                          → 'done'
 *
 * Returns the message text on the question path so the caller can
 * store it in `state.needs` for the FleetView "Needs input" group.
 */
function inferTurnOutcome(text: string): {
  kind: 'done' | 'blocked' | 'failed'
  needs?: string
} {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'done' }

  // failure markers (ant 3988.js `s83` "giving up", `Hq3` verdict-failed,
  // `e83` "ready for" — handled inverted: only true failure phrases).
  if (
    /\b(i\s*can't|giving up|unable to|cannot proceed)\b/i.test(trimmed) ||
    /\b(failed|error|crashed)\b/i.test(trimmed.slice(-200))
  ) {
    // false-positive guard: success messages often contain "no errors".
    if (!/\bno (errors?|failures?)\b/i.test(trimmed.slice(-200))) {
      return { kind: 'failed' }
    }
  }

  // question / blocked markers (ant 3988.js `?` at end + "question:"
  // markers + "[Aa]ction (?:needed|required)").
  const endsWithQuestion = /[?？]\s*$/.test(trimmed)
  const blockedMarker =
    /\b(action (?:needed|required)|need (?:your )?input|please (?:confirm|clarify|tell|specify))\b/i.test(
      trimmed.slice(-300),
    )
  if (endsWithQuestion || blockedMarker) {
    // Use the last sentence (split on `.` or newline) as the needs prompt.
    const lastSentence =
      trimmed
        .split(/[\n.]/)
        .filter(s => s.trim() !== '')
        .pop() ?? trimmed
    return { kind: 'blocked', needs: lastSentence.trim().slice(0, 240) }
  }

  return { kind: 'done' }
}

export function useBgFleetStateSync(
  isLoading: boolean,
  messages: readonly MessageType[],
): void {
  const previousLoadingRef = useRef<boolean | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  useEffect(() => {
    if (process.env.CLAUDE_CODE_SESSION_KIND !== 'bg') return
    const jobDir = process.env.CLAUDE_JOB_DIR
    if (!jobDir) return

    const previous = previousLoadingRef.current
    previousLoadingRef.current = isLoading

    if (previous === null) return
    if (previous === isLoading) return

    void (async () => {
      try {
        invalidateCache(jobDir)
        const current = await readJobState(jobDir)
        if (!current) return

        const now = new Date().toISOString()
        if (isLoading) {
          if (current.state === 'stopped' || current.state === 'failed') return
          if (current.state === 'working' && current.tempo === 'active') return
          await writeJobState(jobDir, {
            ...current,
            state: 'working',
            tempo: 'active',
            needs: undefined,
            updatedAt: now,
          })
        } else {
          if (current.state === 'stopped' || current.state === 'failed') return
          const assistantText = lastAssistantText(messagesRef.current)
          const outcome = inferTurnOutcome(assistantText)
          // ant 3988.js heuristic branches all set `detail:D, output:{result:D}`
          // where D is the short LLM summary. Without an LLM we squeeze
          // to the same 80-char width ant uses for row detail (xf=80).
          const replyDetail = flattenAssistantReply(assistantText, FLEET_DETAIL_MAX)
          if (outcome.kind === 'blocked') {
            // Stay "working" but flip tempo to blocked + record needs.
            // FleetView buckets `tempo='blocked'` into "Needs input"
            // (matches ant deriveBand). Don't set firstTerminalAt — this
            // isn't a terminal outcome, we expect a follow-up.
            await writeJobState(jobDir, {
              ...current,
              state: 'working',
              tempo: 'blocked',
              detail: replyDetail || current.detail,
              needs: outcome.needs,
              updatedAt: now,
            })
          } else if (outcome.kind === 'failed') {
            await writeJobState(jobDir, {
              ...current,
              state: 'failed',
              tempo: 'idle',
              detail: replyDetail || current.detail,
              updatedAt: now,
              firstTerminalAt: current.firstTerminalAt ?? now,
            })
          } else {
            await writeJobState(jobDir, {
              ...current,
              state: 'done',
              tempo: 'idle',
              detail: replyDetail || current.detail,
              // ant: pickMiddleText prefers state.output.result over
              // state.detail for `outcome === 'success'`. Mirror the
              // detail into output.result so the row displays the
              // agent's reply instead of falling back to intent.
              output: replyDetail ? { result: replyDetail } : current.output,
              needs: undefined,
              updatedAt: now,
              firstTerminalAt: current.firstTerminalAt ?? now,
            })
          }
          // Source: ant 3991.js Ja7 — fire namer once per worker after
          // the first turn's classify result resolves to a non-active
          // state, when state.name is still empty AND intent is known.
          // ant gates on `$==="llm"` (classifier source) but ccb's
          // in-worker classifier here is heuristic; the equivalent
          // intent is "we've seen a turn complete and have assistant
          // output to feed the namer". Fires only on blocked/done/failed
          // — never on the active→working transition (no assistant tail
          // yet). The namer module self-debounces with a per-short
          // attempted Set, so re-firing on subsequent turns is a no-op.
          const intent = current.intent ?? current.initialPrompt ?? ''
          if (
            (current.name === undefined || current.name === '') &&
            intent.length > 0
          ) {
            void generateJobName({
              short: basename(jobDir),
              userMsg: intent,
              agentTail: assistantText,
            }).catch(() => undefined)
          }
        }
      } catch {
        // Best-effort — disk sync is observability, not correctness.
      }
    })()
  }, [isLoading])
}
