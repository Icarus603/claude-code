/**
 * REPL hydration — port of ant 4656.js mJK + 3845.js k56/XI7/Px5.
 *
 * When a fork (or resumed agent) starts, the inner agent receives a
 * `replHydration` object that lets its REPL (`vm.Script.runInContext`
 * sandbox) re-execute every prior code block with mocked tool wrappers
 * that return the previous turn's results, so REPL state ends up
 * matching what the user saw.
 *
 * Shape:
 *   { kind: 'fork',  log: ReplayEntry[] }   — fresh fork, log = parent's REPL blocks
 *   { kind: 'resume', log: ReplayEntry[] }  — resumed agent, log reconstructed from messages
 *   { kind: 'fresh' }                       — no hydration (default)
 *
 * `k56` (this module's `reconstructLog`) walks the message history and
 * groups assistant tool_use:REPL with their tool_result outputs into
 * `{ replId, code, calls: [{kind, toolName, result|error}], threw }`
 * entries. ant 3845.js Px5 then `vm.Script(code).runInContext` each one
 * with `calls` driving the wrapper return values.
 *
 * Today ccb's REPLTool is a 1-line stub (`isEnabled: () => false`), so
 * the hydration consumer is a no-op. The k56 extraction still runs and
 * produces correct ReplayEntry[] data, ready for whenever ccb's REPLTool
 * gets a real impl. This is a STRUCTURAL port not a minimal-viable —
 * the data is correct + complete; only the runInContext executor is
 * gated off.
 *
 * @dynamicRequire
 */

import type { Message, AssistantMessage, UserMessage } from './messageShapes.js'

/** ant 3845.js: REPL tool name constant. Mirrored as 'REPL'. */
export const REPL_TOOL_NAME = 'REPL'

/**
 * One mocked tool call inside a REPL block — what the wrapper returned.
 * ant 3845.js: { kind: 'ok' | 'err', toolName, result?, error? }
 */
export type ReplayCall =
  | { kind: 'ok'; toolName: string; result: unknown }
  | { kind: 'err'; toolName: string; error: string }

/**
 * One REPL block: the original code + the sequence of inner-tool calls
 * it made (in order) + whether the original threw. ant 3845.js k56.
 */
export interface ReplayEntry {
  replId: string
  code: string
  calls: ReplayCall[]
  threw: boolean
}

/** Discriminated-union hydration payload. Default 'fresh' = no replay. */
export type ReplHydration =
  | { kind: 'fork'; log: ReplayEntry[] }
  | { kind: 'resume'; log: ReplayEntry[] }
  | { kind: 'fresh' }

/** ant 3845.js MI7 — safely read a string property from a Record/object. */
function readStringProp(obj: unknown, key: string): string {
  if (obj === null || typeof obj !== 'object') return ''
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

/** Cast a content block to a generic record so we can probe untyped fields. */
function asRecord(block: unknown): Record<string, unknown> | null {
  if (typeof block !== 'object' || block === null) return null
  return block as unknown as Record<string, unknown>
}

/** ant 3845.js wx5 — extract REPL tool_use blocks from an assistant message. */
function extractReplToolUses(m: AssistantMessage): Array<{ id: string; code: string }> {
  if (m.isVirtual) return []
  const content = m.message.content
  if (!Array.isArray(content)) return []
  const out: Array<{ id: string; code: string }> = []
  for (const block of content) {
    const b = asRecord(block)
    if (!b) continue
    if (b.type === 'tool_use' && b.name === REPL_TOOL_NAME) {
      out.push({
        id: typeof b.id === 'string' ? b.id : '',
        code: readStringProp(b.input, 'code'),
      })
    }
  }
  return out
}

/** ant 3845.js jx5 — extract pending inner-tool name from a virtual assistant msg. */
function extractPendingName(m: AssistantMessage): string | undefined {
  if (!m.isVirtual) return undefined
  const content = m.message.content
  if (!Array.isArray(content)) return undefined
  const first = asRecord(content[0])
  if (first?.type === 'tool_use' && typeof first.name === 'string') return first.name
  return undefined
}

/** ant 3845.js Jx5 — extract the inner-tool result from a virtual user msg. */
function extractInnerResult(m: UserMessage, toolName: string): ReplayCall | undefined {
  if (!m.isVirtual) return undefined
  const content = m.message.content
  if (!Array.isArray(content)) return undefined
  const first = asRecord(content[0])
  if (!first || first.type !== 'tool_result') return undefined
  const isError = first.is_error === true
  if (isError) {
    return {
      kind: 'err',
      toolName,
      error: typeof first.content === 'string' ? first.content : '',
    }
  }
  return {
    kind: 'ok',
    toolName,
    result: (m as { toolUseResult?: unknown }).toolUseResult,
  }
}

/** ant 3845.js Dx5 — detect if a non-virtual user message reports the REPL block threw. */
function detectReplThrew(m: UserMessage, replId: string): boolean | undefined {
  if (m.isVirtual) return undefined
  const content = m.message.content
  if (!Array.isArray(content)) return undefined
  const matched = content.some(block => {
    const b = asRecord(block)
    return b?.type === 'tool_result' && b?.tool_use_id === replId
  })
  if (!matched) return undefined
  return readStringProp((m as { toolUseResult?: unknown }).toolUseResult, 'error').length > 0
}

/**
 * Reconstruct REPL replay log from a message array — ant 3845.js k56
 * byte-identical.
 *
 * Walks the message stream, opens a new ReplayEntry on each
 * tool_use:REPL block, accumulates virtual {pendingName,result} pairs
 * as `calls`, finalizes on next tool_use:REPL or end of stream.
 */
export function reconstructLog(messages: readonly Message[]): ReplayEntry[] {
  const out: ReplayEntry[] = []
  let cur:
    | {
        replId: string
        code: string
        calls: ReplayCall[]
        threw: boolean
        pendingName: string | undefined
      }
    | undefined
  const flush = (): void => {
    if (!cur) return
    out.push({ replId: cur.replId, code: cur.code, calls: cur.calls, threw: cur.threw })
    cur = undefined
  }
  for (const m of messages) {
    if (m.type !== 'assistant' && m.type !== 'user') continue
    if (m.isVirtual) {
      if (!cur) continue
      if (m.type === 'assistant') {
        const name = extractPendingName(m as AssistantMessage)
        if (name !== undefined) {
          cur.pendingName = name
          continue
        }
      } else {
        const pending = cur.pendingName
        if (pending === undefined) continue
        const call = extractInnerResult(m as UserMessage, pending)
        if (!call) continue
        cur.calls.push(call)
        cur.pendingName = undefined
      }
      continue
    }
    if (m.type === 'assistant') {
      const replUses = extractReplToolUses(m as AssistantMessage)
      if (replUses.length > 0) {
        for (const u of replUses) {
          flush()
          cur = { replId: u.id, code: u.code, calls: [], threw: false, pendingName: undefined }
        }
        continue
      }
    }
    if (cur && m.type === 'user') {
      const threw = detectReplThrew(m as UserMessage, cur.replId)
      if (threw !== undefined) cur.threw = threw
    }
  }
  flush()
  return out
}

/**
 * Hydration consumer — ant 3848.js hydration boot path.
 *
 * Called by inner agent boot (QueryEngine startup) with the parent's
 * replHydration payload + a REPLTool reference. Replays each ReplayEntry
 * through the REPL's vm.runInContext so REPL state ends up matching
 * what the user saw before fork/resume.
 *
 * Returns a summary of how many entries replayed cleanly vs drifted.
 *
 * Today ccb's REPLTool.isEnabled === false, so this returns
 * { skipped: true } without doing anything. Once REPLTool gets a real
 * impl, the consumer becomes active automatically.
 */
export async function hydrateRepl(
  hydration: ReplHydration,
  options?: {
    /** Inject an enabled REPLTool for testing — defaults to ccb's stub. */
    isReplToolEnabled?: () => boolean
    /** Per-entry replay fn — abstracted so tests don't need vm. */
    replayEntry?: (entry: ReplayEntry) => Promise<{ kind: 'ok' | 'drift' | 'threw'; reason?: string }>
  },
): Promise<{
  skipped: boolean
  attempted: number
  ok: number
  drift: number
  threw: number
}> {
  const isEnabled = options?.isReplToolEnabled ?? (() => false)
  if (hydration.kind === 'fresh' || !isEnabled()) {
    return { skipped: true, attempted: 0, ok: 0, drift: 0, threw: 0 }
  }
  const log = hydration.log
  if (log.length === 0) {
    return { skipped: false, attempted: 0, ok: 0, drift: 0, threw: 0 }
  }
  const replayer =
    options?.replayEntry ??
    (async () => ({ kind: 'ok' as const })) // no-op default when REPLTool real impl absent
  let okCount = 0
  let driftCount = 0
  let threwCount = 0
  for (const entry of log) {
    const r = await replayer(entry)
    if (r.kind === 'ok') okCount++
    else if (r.kind === 'drift') driftCount++
    else threwCount++
  }
  return { skipped: false, attempted: log.length, ok: okCount, drift: driftCount, threw: threwCount }
}
