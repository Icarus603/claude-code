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

/**
 * Build the worker argv flags for the left-arrow bridge. Port of the ant
 * `MV6`+`i1O` flag decision (4958.js:102-104 / 4957.js:122-124):
 *
 *   [...(L !== null ? ["--resume", L, "--fork-session"] : []),
 *    ..., ...(_ ? ["--", _] : [])]
 *
 * with `L` = the foreground session id and prompt `_` = null on this path.
 *
 * THE invariant this locks: the backgrounded worker inherits the entire
 * conversation by RESUMING the foreground transcript with a forked id — it is
 * NEVER handed the last user message as a directive to re-run. The directive
 * passed to spawnBgPty is always `''` (no positional → no auto-submitted turn).
 * Re-running was the original bug: the worker started a brand-new session and
 * the prior output vanished.
 *
 * `--session-id <forkedId>` is ALWAYS pushed (ant i1O:124 `b = ["--session-id",
 * z, ...C]`) so the worker uses the pre-allocated id instead of generating its
 * own — otherwise the optimistic FleetView row + on-disk job dir desync into an
 * orphan (see memory feedback_fleet_worker_session_id_must_be_pushed).
 *
 * @param currentSessionId the live foreground session id (ant `L = rt8()`)
 * @param forkedSessionId the pre-allocated id for the forked worker (ant `z`)
 * @param transcriptExists whether the foreground transcript is on disk yet;
 *   when false (a brand-new session with no flushed turn) there is nothing to
 *   resume, so the worker boots fresh with just the forked id (ant gates the
 *   `--resume` on `J = await qOH(j)`, the transcript-file-exists check).
 */
export function buildReplForkFlags(
  currentSessionId: string,
  forkedSessionId: string,
  transcriptExists: boolean,
): string[] {
  return transcriptExists
    ? [
        '--resume',
        currentSessionId,
        '--fork-session',
        '--session-id',
        forkedSessionId,
      ]
    : ['--session-id', forkedSessionId]
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
  /**
   * Session id the worker should `--resume` if it dies and the FleetView
   * right-arrow has to respawn it. For the left-arrow bridge this is the
   * ORIGINAL foreground session (the one whose transcript the worker forked
   * from) — NOT the forked id, because the forked worker's own transcript may
   * not exist on disk yet when a respawn is needed. Mirrors ant `V__`
   * (4952.js) reading `resumeSessionId ?? sessionId` from state.json to build
   * `--resume`. Persisted into state.json so the respawn path can rebuild the
   * same `--resume <orig> --fork-session` flags the original spawn used.
   */
  resumeSessionId?: string
  /**
   * Flags to re-spawn the worker with if it dies (ant `K.respawnFlags`,
   * 4774.js). For the left-arrow bridge this is the SAME fork flags the worker
   * booted with, minus `--resume`/`--session-id` (those are rebuilt from
   * resumeSessionId at respawn time). Persisted into state.json.
   */
  respawnFlags?: readonly string[]
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
    respawnFlags: opts.respawnFlags ? [...opts.respawnFlags] : [],
    intent,
    name: opts.name,
    nameSource: opts.nameSource,
    sessionId,
    // ant V__ (4952.js) builds the respawn `--resume` from `resumeSessionId ??
    // sessionId`. For the left-arrow bridge the worker forked from the original
    // foreground session, so a respawn must resume THAT transcript (which is on
    // disk), not the forked worker's own id (which may not be flushed yet).
    resumeSessionId: opts.resumeSessionId,
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
