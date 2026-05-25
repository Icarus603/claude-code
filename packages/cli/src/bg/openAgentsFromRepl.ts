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

import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { markHasUsedAgentsFleet } from '@claude-code/config'
import {
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
  const seed = deriveReplSeed(messages, '')
  const effectiveSeed = seed ?? { intent: '' }

  const sessionId = randomUUID()
  const cwd = getCwd()

  let short: string
  try {
    ;({ short } = await preSeedReplBgJob(sessionId, {
      intent: effectiveSeed.intent,
      detail: effectiveSeed.detail,
      cwd,
    }))
  } catch (e) {
    return `Cannot open agents — ${e instanceof Error ? e.message : String(e)}`
  }

  // Dispatch the daemon PTY worker (fire-and-forget, ant o14 launches MV6
  // concurrently with the mount). Empty intent → directive "" → the worker
  // idles at an empty prompt (ant "send a prompt to start"); spawnBgPty's
  // optimistic state.json write is skipped for empty directives, so our
  // pre-seeded idle/blocked state.json survives.
  try {
    const { spawnBgPty } = await import('../bg.js')
    void spawnBgPty({
      short,
      directive: effectiveSeed.intent,
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
