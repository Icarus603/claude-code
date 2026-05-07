/**
 * Heuristic classifier — ant 3918.js em7/J08/Up5/iYH/GJ_ byte-identical.
 *
 * Walks the worker output tail and pattern-matches into a {state, detail,
 * tempo, needs?, output?} record. Used as both a fast preclassify (em7)
 * and a fallback when LLM call fails (J08).
 *
 * Code-fence aware: skips matches inside ```...``` blocks via iYH.
 *
 * @dynamicRequire
 */

import {
  type ClassifierResult,
  type WorkerState,
  type WorkerStateFile,
  MAX_DETAIL_CHARS,
  truncate,
} from './state.js'
import {
  AGENTS_STATUS_RE,
  ASK_VERB_RE,
  AUTH_ERROR_RE,
  AWAITING_USER_RE,
  BLOCKED_LINE_RE,
  CANT_PROCEED_RE,
  FAILED_LINE_RE,
  GIVING_UP_RE,
  IM_BLOCKED_RE,
  NEEDS_INPUT_LINE_RE,
  PLEASE_DO_RE,
  PUSHED_COMMITTED_RE,
  READY_FOR_RE,
  STOPPING_HERE_RE,
  VERDICT_RE,
  WAIT_EXTERNAL_RE,
  WILL_CHECK_BACK_RE,
  WORKING_VERB_EXCLUDE_RE,
  WORKING_VERB_RE,
} from './patterns.js'

/** ant iYH — true if `_` index is inside an open code fence. */
export function isInCodeFence(text: string, idx: number): boolean {
  let openMarker: string | null = null
  let openLen = 0
  let pos = 0
  while (pos < idx) {
    const tickAt = text.indexOf('```', pos)
    const tildeAt = text.indexOf('~~~', pos)
    const fenceAt =
      tickAt === -1 ? tildeAt : tildeAt === -1 ? tickAt : Math.min(tickAt, tildeAt)
    if (fenceAt === -1 || fenceAt >= idx) break
    const marker = text[fenceAt]!
    let leftIdx = fenceAt - 1
    let leftCount = 0
    while (leftIdx >= 0 && text[leftIdx] === ' ' && leftCount < 3) {
      leftIdx--
      leftCount++
    }
    const atLineStart = leftIdx < 0 || text[leftIdx] === '\n'
    let runLen = 3
    pos = fenceAt + 3
    while (text[pos] === marker) {
      pos++
      runLen++
    }
    if (!atLineStart) continue
    if (openMarker === null) {
      openMarker = marker
      openLen = runLen
    } else if (openMarker === marker && runLen >= openLen) {
      openMarker = null
      openLen = 0
    }
  }
  return openMarker !== null
}

interface MarkerMatch {
  state: 'failed' | 'blocked'
  capture: string
  index: number
  end: number
}

/** ant Up5 — find the latest line marker (failed/blocked/needs-input) that's NOT in a code fence. */
function findLineMarker(fullText: string, tailText: string, tailOffset: number): MarkerMatch | undefined {
  let result: MarkerMatch | undefined
  const tries: Array<['failed' | 'blocked', RegExp]> = [
    ['failed', new RegExp(FAILED_LINE_RE.source, 'gi')],
    ['blocked', new RegExp(NEEDS_INPUT_LINE_RE.source, 'gi')],
    ['blocked', new RegExp(BLOCKED_LINE_RE.source, 'gi')],
    ['blocked', new RegExp(IM_BLOCKED_RE.source, 'gi')],
  ]
  for (const [state, re] of tries) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(tailText)) !== null) {
      if (isInCodeFence(fullText, tailOffset + m.index)) continue
      if (!result || m.index > result.index) {
        result = {
          state,
          capture: m[1]!.trim(),
          index: m.index,
          end: m.index + m[0].length,
        }
      }
    }
  }
  return result
}

/** ant em7 — full heuristic: run all patterns on tail, return best match or null. */
export function preClassify(text: string): ClassifierResult | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const tail = trimmed.slice(-800)
  const tailOffset = trimmed.length - tail.length

  // 1. result: line marker (done with output.result)
  let resultMatch: RegExpExecArray | null = null
  const resultRe = /(?:^|\n)\s*result:\s*(.+?)\s*(?:\n|$)/gi
  let m: RegExpExecArray | null
  while ((m = resultRe.exec(tail)) !== null) {
    if (!isInCodeFence(trimmed, tailOffset + m.index)) resultMatch = m
  }

  let scanText = tail
  let scanOffset = tailOffset
  if (resultMatch) {
    const after = resultMatch.index + resultMatch[0].length
    scanText = tail.slice(after)
    scanOffset = tailOffset + after
  }

  const marker = findLineMarker(trimmed, scanText, scanOffset)

  // 2. result: + next: → working
  if (resultMatch && !marker) {
    const detail = truncate(resultMatch[1]!.trim())
    const nextRe = /(?:^|\n)\s*next:\s*\S/gi
    if (
      [...scanText.matchAll(nextRe)].some(
        n => !isInCodeFence(trimmed, scanOffset + n.index!),
      )
    ) {
      return {
        branch: 'result-then-next',
        state: 'working',
        tempo: 'idle',
        detail,
        output: { result: detail },
        source: 'preclassify',
      }
    }
    return {
      branch: 'result-marker',
      state: 'done',
      tempo: 'idle',
      detail,
      output: { result: detail },
      source: 'preclassify',
    }
  }

  if (marker?.state === 'failed') {
    return {
      branch: 'failed-marker',
      state: 'failed',
      tempo: 'idle',
      detail: truncate(marker.capture),
      output: {},
      source: 'preclassify',
    }
  }

  if (marker?.state === 'blocked') {
    const after = scanText.slice(marker.end)
    const paragraphCount = after.split(/\n\s*\n/).filter(p => p.trim().length > 0).length
    if (paragraphCount >= 3) return null
    if (
      !/\bnothing (?:needed|required) from you\b|\bno(?: user)? action (?:needed|required)\b/i.test(scanText)
    ) {
      const need = truncate(marker.capture)
      return { branch: 'blocked-marker', state: 'blocked', tempo: 'blocked', needs: need, detail: need, source: 'preclassify' }
    }
    if (resultMatch) {
      const d = truncate(resultMatch[1]!.trim())
      return { branch: 'blocked-disclaimed', state: 'done', tempo: 'idle', detail: d, output: { result: d }, source: 'preclassify' }
    }
    return null
  }

  // 3. trailing question
  if (/[?\uFF1F]\s*$/.test(tail) && tail.replace(/[?\uFF1F\s]+$/, '').length >= 4) {
    const lastBreak = Math.max(
      tail.lastIndexOf('\n'),
      tail.lastIndexOf('. '),
      tail.lastIndexOf('! '),
      tail.lastIndexOf('? ', tail.length - 2),
    )
    if (!isInCodeFence(trimmed, tailOffset + lastBreak)) {
      const q = truncate(tail.slice(lastBreak + 1).trim())
      return { branch: 'trailing-q', state: 'blocked', tempo: 'blocked', needs: q, detail: q, source: 'preclassify' }
    }
  }

  // 4. last sentence patterns
  const sentBreak = Math.max(
    0,
    tail.lastIndexOf('. '),
    tail.lastIndexOf('! '),
    tail.lastIndexOf('? '),
    tail.lastIndexOf('\n'),
  )
  const lastSent = tail.slice(sentBreak).replace(/^[.!?\s]+/, '')
  const inFence = isInCodeFence(trimmed, tailOffset + sentBreak)

  const wait = WAIT_EXTERNAL_RE.exec(lastSent)
  if (wait && !inFence) {
    return { branch: 'wait-external', state: 'working', tempo: 'idle', detail: truncate(wait[0]), output: {}, source: 'preclassify' }
  }
  const awaitUser = AWAITING_USER_RE.exec(lastSent)
  if (awaitUser && !inFence) {
    const need = truncate(lastSent.slice(awaitUser.index).trim())
    return { branch: 'awaiting-user', state: 'blocked', tempo: 'blocked', needs: need, detail: need, source: 'preclassify' }
  }
  const askVerb = ASK_VERB_RE.exec(lastSent)
  if (askVerb && !inFence) {
    const need = truncate(lastSent.slice(askVerb.index).trim())
    return { branch: 'ask-verb', state: 'blocked', tempo: 'blocked', needs: need, detail: need, source: 'preclassify' }
  }
  if (!inFence && AUTH_ERROR_RE.test(lastSent)) {
    return { branch: 'auth-prose', state: 'blocked', tempo: 'blocked', needs: truncate(lastSent), detail: 'authentication required', source: 'preclassify' }
  }
  if (!inFence && WORKING_VERB_RE.test(lastSent) && !WORKING_VERB_EXCLUDE_RE.test(lastSent)) {
    return { branch: 'working-verb', state: 'working', tempo: 'active', detail: truncate(lastSent), output: {}, source: 'preclassify' }
  }
  if (!inFence && AGENTS_STATUS_RE.test(lastSent)) {
    return { branch: 'agents-status', state: 'working', tempo: 'idle', detail: truncate(lastSent), source: 'preclassify' }
  }
  if (!inFence && WILL_CHECK_BACK_RE.test(lastSent)) {
    return { branch: 'will-check-back', state: 'working', tempo: 'idle', detail: truncate(lastSent), source: 'preclassify' }
  }
  if (!inFence && CANT_PROCEED_RE.test(lastSent)) {
    const d = truncate(lastSent)
    return { branch: 'cant-proceed', state: 'blocked', tempo: 'blocked', detail: d, needs: d, source: 'preclassify' }
  }
  if (!inFence && GIVING_UP_RE.test(lastSent)) {
    return { branch: 'giving-up', state: 'failed', tempo: 'idle', detail: truncate(lastSent), source: 'preclassify' }
  }
  if (!inFence && PUSHED_COMMITTED_RE.test(lastSent)) {
    const d = truncate(lastSent)
    return { branch: 'pushed-committed', state: 'done', tempo: 'idle', detail: d, output: { result: d }, source: 'preclassify' }
  }
  if (!inFence && READY_FOR_RE.test(lastSent)) {
    return { branch: 'ready-for', state: 'done', tempo: 'idle', detail: truncate(lastSent), source: 'preclassify' }
  }
  if (!inFence && VERDICT_RE.test(lastSent)) {
    const d = truncate(lastSent)
    return { branch: 'verdict-marker', state: 'done', tempo: 'idle', detail: d, output: { result: d }, source: 'preclassify' }
  }
  if (!inFence && PLEASE_DO_RE.test(lastSent)) {
    const d = truncate(lastSent)
    return { branch: 'please-do-x', state: 'blocked', tempo: 'blocked', detail: d, needs: d, source: 'preclassify' }
  }
  if (!inFence && STOPPING_HERE_RE.test(lastSent)) {
    const d = truncate(lastSent)
    return { branch: 'stopping-here', state: 'blocked', tempo: 'blocked', detail: d, needs: d, source: 'preclassify' }
  }
  return null
}

/** ant J08 — ultra-fallback: classify as working/idle, detail = last non-empty line. */
export function fallbackHeuristic(text: string): ClassifierResult {
  const lastLine = text
    .split('\n')
    .map(l => l.trim())
    .findLast(Boolean)
  return {
    branch: 'heuristic',
    state: 'working',
    tempo: 'idle',
    detail: lastLine ? truncate(lastLine) : '\u2014',
    source: 'heuristic',
  }
}

/** ant tm7 — describe the closing-shape so LLM prompt can include it. */
export function closingShape(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return 'empty'
  if (isInCodeFence(trimmed, trimmed.length)) return 'code-fence'
  const tail = trimmed.slice(-800)
  const tailOffset = trimmed.length - tail.length
  for (const m of tail.matchAll(/(?:^|\n)\s*result:\s*\S/gi)) {
    if (!isInCodeFence(trimmed, tailOffset + m.index!)) return 'result-line'
  }
  for (const m of tail.matchAll(/(?:^|\n)\s*failed:\s*\S/gi)) {
    if (!isInCodeFence(trimmed, tailOffset + m.index!)) return 'failed-line'
  }
  if (/[?\uFF1F]\s*$/.test(trimmed)) return 'trailing-q'
  const last200 = trimmed.slice(-200)
  if (/(?:^|\n)\s*(?:[-*\u2022]|\d+\.|[|])\s/.test(last200)) return 'list-or-table'
  return 'declarative'
}

/** ant GJ_ — merge LLM output with prev state, default-fill. */
const VALID_STATES = new Set<WorkerState>(['working', 'blocked', 'done', 'failed'])
const TERMINAL_TEMPO_LOCK = new Set<WorkerState>(['done', 'failed', 'stopped', 'crashed'])

export function mergeWithPrev(
  raw: { state?: unknown; detail?: unknown; tempo?: unknown; needs?: unknown; output?: unknown },
  prev: WorkerState,
  fallback: ClassifierResult | null,
): { state: WorkerState; detail: string; tempo: 'active' | 'idle' | 'blocked'; needs?: string; output: Record<string, string> } {
  const rawState = typeof raw.state === 'string' && raw.state ? (raw.state as WorkerState) : undefined
  const state: WorkerState =
    rawState && VALID_STATES.has(rawState) ? rawState : (fallback?.state ?? prev)
  const rawTempo = typeof raw.tempo === 'string' && raw.tempo ? raw.tempo : undefined
  const tempo =
    TERMINAL_TEMPO_LOCK.has(state)
      ? 'idle'
      : rawTempo === 'active' || rawTempo === 'idle' || rawTempo === 'blocked'
        ? rawTempo
        : (fallback?.tempo ?? 'active')
  const output: Record<string, string> = {}
  const rawOut = (raw.output as Record<string, unknown> | undefined) ?? fallback?.output
  if (rawOut && typeof rawOut === 'object') {
    for (const [k, v] of Object.entries(rawOut)) {
      if (typeof v === 'string' && v && k === 'result') {
        output[k] = truncate(v, MAX_DETAIL_CHARS)
      }
    }
  }
  const rawNeeds = typeof raw.needs === 'string' && raw.needs ? raw.needs : undefined
  const needs = rawNeeds ?? (tempo === 'blocked' ? fallback?.needs : undefined)
  return {
    state,
    detail: (typeof raw.detail === 'string' && raw.detail) || fallback?.detail || '',
    tempo,
    needs,
    output,
  }
}

/** ant qp7 — strip ```json fence + extract JSON object from LLM text. */
export function parseLlmJson(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  const first = stripped.indexOf('{')
  const last = stripped.lastIndexOf('}')
  if (first < 0 || last < 0) return null
  try {
    return JSON.parse(stripped.slice(first, last + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Used by orchestrator to gate state file write. */
export function shouldUpdateState(prev: WorkerStateFile | null, next: { state: WorkerState; detail: string; tempo: string; needs?: string }): boolean {
  if (!prev) return true
  return (
    prev.state !== next.state ||
    prev.detail !== next.detail ||
    prev.tempo !== next.tempo ||
    (prev.needs ?? '') !== (next.needs ?? '')
  )
}
