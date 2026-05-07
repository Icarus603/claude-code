/**
 * `/background` execute body.
 *
 * Mirror of ant 4650.js Tf3 + ew6 — convert the running interactive
 * session into a background job. The original REPL exits gracefully
 * (the terminal returns to the shell); a child `ccb -p "<directive>"`
 * is spawned in the same cwd, with its meta.json persisted under
 * ~/.claude/jobs/<short>/.
 *
 * If we're already inside a bg session (CLAUDE_CODE_SESSION_KIND=bg),
 * fall through to gracefulShutdown without spawning anything — this
 * mirrors ant Tf3 line 254 (`if (E7()) ...g7H()...`).
 *
 * @dynamicRequire
 */

import * as React from 'react'

import { logEvent } from '@claude-code/local-observability'

import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import { isBgSession } from '@claude-code/agent/concurrentSessions.js'
import type { Message } from '@claude-code/agent/messageShapes'
import { gracefulShutdown } from '@claude-code/app-host/bootstrap/gracefulShutdown.js'

/**
 * Derive an intent + assistant-detail snippet from the parent's
 * conversation. Mirrors ant 4650.js Hj6 — walk messages newest-first,
 * capture the last user prompt as `intent`, the last assistant text as
 * `detail` (compressed to a single line, capped at 120 chars). Used as
 * a fallback when /background is invoked with no directive.
 *
 * Returns null when there's no user message in history yet — the
 * caller surfaces "Nothing to background yet" matching ant Tf3:264.
 */
function deriveBackgroundSeed(
  messages: ReadonlyArray<Message>,
  fallbackIntent: string,
): { intent: string; detail?: string } | null {
  let intent: string | undefined = fallbackIntent || undefined
  let detail: string | undefined
  let sawUser = false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    if (m.type === 'assistant' && detail === undefined) {
      const content = (m as { message?: { content?: unknown } }).message?.content
      const text = extractTextFromContent(content)
      if (text)
        detail = text.replace(/\s+/g, ' ').trim().slice(0, 120) || undefined
    }
    if (m.type === 'user' && !(m as { isMeta?: boolean }).isMeta) {
      const userText = extractTextFromContent(
        (m as { message?: { content?: unknown } }).message?.content,
      )?.trim()
      sawUser = true
      if (!intent && userText) intent = userText
    }
    if (sawUser && intent && detail !== undefined) break
  }
  if (!sawUser) return null
  return {
    intent: (intent || '(backgrounded)').slice(0, 200),
    ...(detail ? { detail } : {}),
  }
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text'
    ) {
      const t = (block as { text?: unknown }).text
      if (typeof t === 'string') return t
    }
  }
  return undefined
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  rawContext: unknown,
  args: string,
): Promise<React.ReactNode> {
  const context = rawContext as {
    toolUseContext?: { messages?: ReadonlyArray<Message> }
  }
  // Already in a bg session — ant Tf3:254 short-circuit.
  if (isBgSession()) {
    logEvent('tengu_bg_agent_action', {
      action: 'stop',
      source: 'background_command_already_bg',
    })
    onDone('Already running in the background — exiting.')
    await gracefulShutdown(0, 'prompt_input_exit')
    return null
  }

  // ant 4650.js Tf3:262-265 + Hj6 — derive intent + detail from
  // parent messages when no explicit directive is given. Without a
  // user message in history, ant short-circuits with "Nothing to
  // background yet — send a message first."
  const explicit = (args ?? '').trim()
  const messages = context?.toolUseContext?.messages ?? []
  const seed = deriveBackgroundSeed(messages, explicit)
  if (seed === null) {
    onDone('Nothing to background yet — send a message first.', {
      display: 'system',
    })
    return null
  }
  const directive = seed.intent

  // ant 4650.js ew6 inherits parent context via --resume <session-id>
  // --fork-session. Without these flags, the bg job starts blank and
  // loses the conversation the user wants backgrounded. Mirror.
  const flags: string[] = []
  try {
    const { getSessionId } = await import(
      '@claude-code/app-host/bootstrap/state.js'
    )
    const sessionId = getSessionId()
    if (sessionId) flags.push('--resume', String(sessionId), '--fork-session')
  } catch {
    // best-effort — fall through to a blank session if state lookup fails.
  }

  // ant 4650.js ew6:96-104 — worktree handoff. If the original REPL
  // is running inside a swarm worktree session, propagate the worktree
  // path so the bg child enters the same worktree (matches ant
  // `worktree: { path, branch, hookBased, originCwd }` envelope).
  // The bg child sees these via --add-dir + the swarm hooks restore
  // the rest from session metadata.
  let cwd = process.cwd()
  let hadWorktree = false
  let handedOff = false
  try {
    const { getCurrentWorktreeSession } = await import('@claude-code/swarm')
    const wt = getCurrentWorktreeSession()
    if (wt) {
      hadWorktree = true
      // ant `enteredExisting` distinction: if the user resumed into an
      // existing worktree (creationDurationMs unset), the supervisor
      // hands the same worktree off rather than letting the bg child
      // re-create it.
      handedOff = wt.creationDurationMs === undefined
      cwd = wt.worktreePath
      // --add-dir grants access; the worktree itself is already on
      // disk so we don't need to re-run create_worktree machinery.
      flags.push('--add-dir', wt.worktreePath)
    }
  } catch {
    // worktree package is optional / could be feature-gated. Fall
    // through with the original cwd — the bg job still works, just
    // without worktree continuity.
  }

  let short: string | undefined
  try {
    const { spawnBgJob } = await import('@claude-code/cli/bg.js')
    short = await spawnBgJob({
      flags,
      directive,
      cwd,
    })
  } catch (e) {
    onDone(`Couldn't background — ${(e as Error).message}`, {
      display: 'system',
    })
    return null
  }

  logEvent('tengu_bg_agent_action', {
    action: 'spawn',
    source: 'background_command',
  })
  // ant 4650.js Tf3:172 — extra telemetry mirror for the slash-command
  // path (vs the --bg flag path). Tracks worktree handoff behavior.
  logEvent('tengu_background_fork', {
    confirmed: 'true',
    inflight_count: '0',
    had_prompt: explicit ? 'true' : 'false',
    had_worktree: String(hadWorktree),
    worktree_handed_off: String(handedOff),
  })

  const handoffMsg = handedOff ? ' (worktree handed off)' : ''
  onDone(
    `Backgrounded as ${short}${handoffMsg}. The original session is exiting.`,
  )
  await gracefulShutdown(0, 'prompt_input_exit')
  return null
}
