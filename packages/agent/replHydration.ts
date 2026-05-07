/**
 * REPL hydration — port of ant 4656.js mJK lines 29-37.
 *
 * When a fork (or resumed agent) starts, it can be seeded with a
 * `replHydration` object on its runAgent override. The inner agent
 * uses this to rebuild a replay log of the parent's UI state so the
 * subagent's transcript stays consistent with what the parent saw.
 *
 * Shape:
 *   { kind: 'fork',  log: ReplayEntry[] }   — fresh fork, log is parent's tail
 *   { kind: 'resume', log: ReplayEntry[] }  — resumed agent, log reconstructed
 *                                             from messages via reconstructLog()
 *
 * Consumer side (the inner agent) reads override.replHydration on
 * startup; if present, rehydrates its REPL state from log[]. ccb's
 * inner-agent consumer is wired in agent/QueryEngine.ts; if hydration
 * data is provided but the consumer hasn't been wired for the agent
 * type, we log a debug message rather than fail.
 *
 * @dynamicRequire
 */

import type { Message } from './messageShapes.js'

/** Single replay entry — one parent UI tick that the fork can render. */
export interface ReplayEntry {
  /** Originating message id (when available). */
  uuid?: string
  /** Display kind: 'assistant' | 'user' | 'tool_result' | etc. */
  kind: string
  /** Pre-rendered text content (HTML/ANSI as appropriate). */
  content: string
  /** Timestamp (ms epoch) of the original tick, if known. */
  ts?: number
}

/** Discriminated-union hydration payload. */
export type ReplHydration =
  | { kind: 'fork'; log: ReplayEntry[] }
  | { kind: 'resume'; log: ReplayEntry[] }

/**
 * Reconstruct a replay log from a message array — ant 4656.js k56().
 * Walks assistant turns, extracts user-visible text + tool_use names,
 * produces one ReplayEntry per turn boundary.
 *
 * Best-effort: if a message shape doesn't fit the standard turn
 * pattern, it's skipped rather than throwing. The log's purpose is
 * UI-rehydration not transcript fidelity.
 */
export function reconstructLog(messages: readonly Message[]): ReplayEntry[] {
  const out: ReplayEntry[] = []
  for (const m of messages) {
    if (m.type !== 'assistant' && m.type !== 'user') continue
    const content = m.message.content
    let text = ''
    if (typeof content === 'string') {
      text = content
    } else if (Array.isArray(content)) {
      const parts: string[] = []
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue
        const b = block as unknown as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push(b.text)
        } else if (b.type === 'tool_use' && typeof b.name === 'string') {
          parts.push(`[tool_use: ${b.name}]`)
        } else if (b.type === 'tool_result') {
          const c = b.content
          if (typeof c === 'string') parts.push(c)
        }
      }
      text = parts.join('\n')
    }
    if (!text) continue
    out.push({
      uuid: typeof m.uuid === 'string' ? m.uuid : undefined,
      kind: m.type,
      content: text,
      ts: typeof m.timestamp === 'string' ? Date.parse(m.timestamp) : undefined,
    })
  }
  return out
}
