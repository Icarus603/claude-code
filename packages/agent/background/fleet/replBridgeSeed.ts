/**
 * REPL → FleetView bridge: seed derivation + state.json pre-seed.
 *
 * Port of ant 2.1.150:
 *   - `fV6` (4958.js) → deriveReplSeed — derive {intent, detail} from the
 *     current REPL message list so the backgrounded job shows meaningful
 *     text in FleetView.
 *   - `dt8` (4957.js) → preSeedReplBgJob — write the job's state.json BEFORE
 *     the worker spawns, so the row appears in FleetView immediately. Empty
 *     intent → tempo="blocked" + needs="send a prompt to start".
 *
 * See memory: project_ant_2150_leftarrow_bridge_source.
 */
import {
  getAssistantMessageText,
  getUserMessageText,
} from '../../messages.js'
import type { Message } from '../../messageShapes.js'
import { getJobDir, writeJobState } from './fleetStore.js'
import type { FleetJobState } from './fleetTypes.js'

// ant 4958.js:33 / 4957.js:938 constants.
export const NEEDS_SEND_PROMPT = 'send a prompt to start' // ant gt8
export const IDLE_DETAIL = `(idle — ${NEEDS_SEND_PROMPT})` // ant Qt8

/** Derived seed for a backgrounded REPL session. ant `fV6` return shape. */
export interface ReplBridgeSeed {
  /** Last user message text, sliced to 200. Default "(backgrounded)". */
  intent: string
  /** Last assistant message text, whitespace-collapsed, sliced to 120. */
  detail?: string
  /** Display name, if the session already had one. */
  name?: string
  /** Whether the name was user-set or auto-derived. */
  nameSource?: 'user' | 'auto'
}

/**
 * Derive a background seed from the REPL message list. Port of ant `fV6`.
 *
 * Reverse-scans messages: the most recent assistant text becomes `detail`
 * (whitespace-collapsed, ≤120 chars); the most recent non-meta user text
 * becomes `intent` (≤200 chars). Returns `null` when there is no user
 * message AND no override — the caller then treats it as an empty seed
 * (idle/blocked state.json).
 *
 * @param messages current REPL conversation
 * @param override optional pre-supplied intent (ant's `_` arg; "" from the
 *   bridge). When set, it wins as the intent and forces a non-null return.
 */
export function deriveReplSeed(
  messages: readonly Message[],
  override = '',
): ReplBridgeSeed | null {
  let intent = override
  let foundUser = false
  let detail: string | undefined

  // ant fV6: reverse scan. assistant → detail (first/most-recent only),
  // user (non-meta) → intent (first/most-recent only).
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type === 'assistant' && detail === undefined) {
      const text = getAssistantMessageText(m)
      if (text) detail = text.replace(/\s+/g, ' ').trim().slice(0, 120)
    }
    if (m.type === 'user' && m.isMeta !== true) {
      const text = getUserMessageText(m)?.trim()
      // ant skips command/meta-ish user text (dtH filter); ccb's
      // getUserMessageText already strips most of that, so we take the
      // first non-empty user text as intent.
      if (text) {
        foundUser = true
        if (!intent) intent = text
      }
    }
    if (foundUser && intent && detail !== undefined) break
  }

  // ant: `if (!K && !_) return null` — no user message and no override.
  if (!foundUser && !override) return null

  return {
    intent: (intent || '(backgrounded)').slice(0, 200),
    detail,
  }
}

/** Options for {@link preSeedReplBgJob}, mirroring ant `dt8`'s second arg. */
export interface PreSeedOptions {
  intent?: string
  detail?: string
  name?: string
  nameSource?: 'user' | 'auto'
  cwd: string
  sessionPermissionRules?: { allow: string[]; deny: string[] }
  worktreePath?: string
  worktreeBranch?: string
  worktreeHookBased?: boolean
  originCwd?: string
  memoryToggledOff?: boolean
}

/**
 * Write a backgrounded job's state.json BEFORE the worker spawns, so the
 * FleetView row appears immediately. Port of ant `dt8`.
 *
 * Empty intent (no intent AND no detail) → tempo="blocked",
 * needs="send a prompt to start", detail="(idle — send a prompt to start)".
 * That's how the row reads "send a prompt to start" before the user types.
 *
 * @param sessionId full session UUID; short id = first 8 chars
 * @returns the short id and on-disk job directory
 */
export async function preSeedReplBgJob(
  sessionId: string,
  opts: PreSeedOptions,
): Promise<{ short: string; jobDir: string }> {
  const short = sessionId.slice(0, 8)
  const jobDir = getJobDir(short)

  const intent = opts.intent ?? ''
  // ant dt8: T = (intent === "" && !detail) → idle/blocked treatment.
  const isIdle = intent === '' && !opts.detail

  const now = new Date().toISOString()
  const state: FleetJobState = {
    // status is ALWAYS 'working' — the freshly-spawned worker IS running (it
    // just hasn't been given a prompt yet). idle-ness lives in `tempo`
    // (blocked) + `needs`, NOT in the status field. This matches ant: its
    // empty-intent job has state.state==="working" + tempo treatment, which is
    // exactly what the FleetView label's "new session" branch keys on
    // (`template==="bg" && state==="working"`). Writing 'blocked' here made a
    // non-current empty job fall through to the bare "bg" template label.
    state: 'working',
    tempo: isIdle ? 'blocked' : 'active',
    detail: opts.detail ?? (isIdle ? IDLE_DETAIL : ''),
    needs: isIdle ? NEEDS_SEND_PROMPT : undefined,
    output: null,
    children: null,
    linkScanOffset: 0,
    template: 'bg',
    respawnFlags: [],
    intent,
    name: opts.name,
    nameSource: opts.nameSource,
    sessionId,
    daemonShort: short,
    cwd: opts.cwd,
    createdAt: now,
    updatedAt: now,
    firstTerminalAt: null,
    worktreePath: opts.worktreePath,
    worktreeBranch: opts.worktreeBranch,
    worktreeHookBased: opts.worktreeHookBased,
    originCwd: opts.originCwd,
    backend: 'daemon',
  }

  await writeJobState(jobDir, state)
  return { short, jobDir }
}
