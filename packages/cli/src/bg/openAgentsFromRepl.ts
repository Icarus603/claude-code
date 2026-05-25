/**
 * REPL ←-arrow → FleetView bridge. Port of ant 2.1.150 `o14` (5279.js) +
 * `l14` (5278.js).
 *
 * Flow (ant o14):
 *   1. derive a seed from the current REPL messages
 *   2. pre-seed the job's state.json so the FleetView row appears at once
 *      (empty intent → "send a prompt to start")
 *   3. dispatch a daemon-managed PTY worker (fire-and-forget) for the job
 *   4. mark hasUsedAgentsFleet (keeps the footer hint sticky)
 *   5. in-process: unmount the REPL Ink root, focus the new row via
 *      CLAUDE_AGENTS_SELECT, and hand control to the FleetView mount loop
 *
 * The unmount (step 5) → FleetView createRoot is exactly the
 * mount→unmount→remount stdin cycle that broke the original port; the
 * native stdin reader (stdin-napi) survives it, which is why this bridge
 * is now viable. See memory: project_ant_2150_leftarrow_bridge_source.
 *
 * Divergence from ant: rather than re-implementing ant `l14`'s bespoke
 * createRoot loop, ccb reuses `agentsFleetHandler` — the same self-contained
 * FleetView mount loop that backs `ccb agents` (spare pool + dispatch +
 * attach already wired). CLAUDE_AGENTS_SELECT seeds the focused row.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import {
  getSessionId,
  isSessionPersistenceDisabled,
} from '@claude-code/app-host/bootstrap/state.js'
import { markHasUsedAgentsFleet } from '@claude-code/config'
import {
  flushSessionStorage,
  getTranscriptPath,
} from '@claude-code/storage/sessionStorage.js'
import {
  buildReplForkFlags,
  deriveReplSeed,
  preSeedReplBgJob,
} from '@claude-code/agent/background/fleet/replBridgeSeed.js'
import type { Message } from '@claude-code/agent/messageShapes.js'

/**
 * Open FleetView from the REPL, backgrounding the current conversation as a
 * new bg job. Returns an error string on failure (the caller surfaces it as
 * a warning) — on success it does not return: it unmounts the REPL and
 * process.exit(0)s into FleetView.
 *
 * @param messages current REPL conversation, for seed derivation
 */
export async function openAgentsFromReplLeftArrow(
  messages: readonly Message[],
): Promise<string | undefined> {
  // Guard against fork-bomb: a bg/worker session must NEVER background itself
  // into another fleet job. Only a foreground interactive REPL opens agents.
  if (
    process.env.CLAUDE_CODE_SESSION_KIND === 'bg' ||
    process.env.CCB_FLEET_ATTACH_CHILD === '1' ||
    process.env.CLAUDE_BG_SOURCE !== undefined
  ) {
    return undefined
  }
  // ant o14 step 1+guard (5279.js:11-13): if a seed is derivable but session
  // persistence is OFF, the forked job would have no transcript to resume —
  // refuse rather than silently spawning a blank session.
  const seed = deriveReplSeed(messages, '')
  if (seed !== null && isSessionPersistenceDisabled()) {
    return 'Cannot open agents — session persistence is disabled, so this conversation cannot be backgrounded.'
  }
  const effectiveSeed = seed ?? { intent: '' }

  // The CURRENT foreground session — this is what the worker --resumes so it
  // inherits the full transcript (ant MV6 `L = rt8()` = the live sessionFile).
  // The worker is spawned with --fork-session so it gets a FRESH id and never
  // contends with the foreground session's file. `forkedSessionId` is that
  // fresh id (ant MV6 `Y = randomUUID()`, pushed as --session-id).
  const currentSessionId = getSessionId()
  const forkedSessionId = randomUUID()
  const cwd = getCwd()

  // Only resume if the foreground transcript actually exists on disk. A brand
  // new session that hasn't flushed any turn yet has nothing to inherit; in
  // that case fall back to a plain fresh worker (ant i1O: `f = [...J ?
  // ["--resume", w] : [], ...]` — the `--resume` is gated on the transcript
  // file existing, `J = await qOH(j)`).
  const transcriptExists = existsSync(getTranscriptPath())

  let short: string
  try {
    ;({ short } = await preSeedReplBgJob(forkedSessionId, {
      intent: effectiveSeed.intent,
      detail: effectiveSeed.detail,
      cwd,
    }))
  } catch (e) {
    return `Cannot open agents — ${e instanceof Error ? e.message : String(e)}`
  }

  // Dispatch the worker (fire-and-forget; ant o14 launches MV6 concurrently
  // with the mount). THE FIX: the worker is NOT handed the last user message
  // as a directive to re-run. It inherits the entire conversation by resuming
  // the foreground transcript with a forked id, and boots with an EMPTY
  // directive so it does NOT re-submit a turn. Mirrors ant MV6 (4958.js:102):
  //   [...(L !== null ? ["--resume", L, "--fork-session"] : []), ...,
  //    ...(_ ? ["--", _] : [])]   ← prompt `_` is null on the left-arrow path,
  // so no `--` positional is appended. The seed.intent is DISPLAY-ONLY (the
  // FleetView row's middle column), already persisted via preSeedReplBgJob.
  //
  // --session-id is ALWAYS pushed for the forked worker (ant i1O:124
  // `b = ["--session-id", z, ...C]`); without it the worker auto-generates a
  // UUID and the optimistic row + on-disk job dir desync → orphan. See memory
  // feedback_fleet_worker_session_id_must_be_pushed. The decision is a pure
  // helper (buildReplForkFlags) so the invariant is unit-tested.
  const flags = buildReplForkFlags(
    currentSessionId,
    forkedSessionId,
    transcriptExists,
  )

  // Drain the transcript write queue before the worker resumes it. The
  // foreground REPL's useLogMessages enqueues writes fire-and-forget
  // (insertMessageChain → `void enqueueWrite`), so the last turn's entries
  // may still be in flight even though the turn has completed. Without this,
  // the forked worker can --resume a transcript that's missing its tail —
  // the conversation reappears truncated. Mirrors ant o14's `f.flush()`
  // (5279.js:46) before the fork dispatch. Best-effort + time-boxed so a
  // stuck queue can't wedge the handoff (ant bounds it at 2000ms via tO).
  if (transcriptExists) {
    await Promise.race([
      flushSessionStorage().catch(() => {}),
      new Promise<void>(resolve => setTimeout(resolve, 2000)),
    ])
  }

  try {
    const { spawnBgPty } = await import('../bg.js')
    void spawnBgPty({
      short,
      flags,
      directive: '',
      cwd,
      quiet: true,
      waitForSocketMs: 0,
    }).catch(err => {
      // Rollback on spawn failure (ant o14: rm jobDir + log).
      void import('@claude-code/agent/background/fleet/fleetStore.js')
        .then(({ deleteJobDir }) => deleteJobDir(short))
        .catch(() => {})
      process.stderr.write(
        `background spawn failed: ${(err as Error).message}\n`,
      )
    })
  } catch (e) {
    return `Cannot open agents — ${e instanceof Error ? e.message : String(e)}`
  }

  // Sticky gate marker (ant k8H, called on successful dispatch).
  markHasUsedAgentsFleet()

  // Activate the native stdin reader for the FleetView mount that follows.
  // The libuv TTY-poll bug only bites AFTER this in-process unmount→re-mount,
  // so the reader is scoped to exactly here — the foreground REPL keeps native
  // process.stdin (normal IME, no lag). App.useNativeReader() gates on this.
  process.env.CCB_FLEET_INPROCESS_REMOUNT = '1'

  // In-process mount (ant l14). Unmount the REPL Ink root, then hand off to
  // the FleetView mount loop. The focused row is seeded via the env var the
  // handler reads as initialFocusedShort.
  const { instances } = await import('@anthropic/ink')
  const inst = instances.get(process.stdout)
  try {
    // Handoff unmount: leaves the REPL launcher's waitUntilExit() pending so
    // it does NOT gracefulShutdown(0) the process when we tear down the REPL
    // root. FleetView (mounted below) owns the rest of the process lifetime.
    // Without this, the launcher's `await waitUntilExit(); gracefulShutdown(0)`
    // chain exits the whole process right after FleetView mounts.
    inst?.unmountForHandoff()
  } catch {
    // best-effort; proceed to mount FleetView even if unmount throws
  }
  await new Promise<void>(resolve => setImmediate(resolve))
  process.env.CLAUDE_AGENTS_SELECT = short

  const { agentsFleetHandler } = await import('../handlers/agentsFleet.js')
  await agentsFleetHandler()
  process.exit(0)
}
