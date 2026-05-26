/**
 * fleetAttach — runs the attach handoff between two FleetView mounts.
 *
 * Source: ant 5092.js Ot3 attach branch — after FleetView resolves with
 * action="open", ant calls `await kZ6(short, freshDispatch ? void 0 : {knownState, knownAlive})`
 * (`GsH` in 4774.js) BEFORE attach. That respawn-gate either fast-returns
 * "alive" (worker confirmed running) or runs the respawn workflow, then
 * the daemon ATTACH op connects. ant's gate gives the worker time to
 * become reachable — fresh-dispatch + immediate right-arrow doesn't
 * race the worker boot.
 *
 * ccb mirrors this by polling for pty.sock with a generous budget (10s,
 * matching ant's spare-ready timeout) when meta.json says a worker was
 * dispatched but the socket hasn't appeared yet. This is the ant-aligned
 * "wait for worker to be reachable" step.
 *
 * Two paths in ccb — BOTH go through the daemon, NEVER a foreground REPL.
 * This mirrors ant `$nK` (4951.js): every attach connects to a daemon-managed
 * worker over its PTY socket; ant has NO codepath that spawns a foreground
 * REPL on the user's TTY. Failures surface as an error string → the
 * agentsFleet loop shows a toast and remounts FleetView (ant Ot3 `J = k.msg`).
 *
 *   1. Live PTY socket (meta.ptySocket or <jobDir>/pty.sock exists, OR
 *      appears within budget): runAttach connects to it. Sub-100ms once
 *      the socket is live. Used for fresh dispatches + existing alive
 *      workers.
 *   2. Dead/orphaned (state.json exists but no live socket after polling):
 *      RESPAWN the worker through the daemon (spawnBgPty, --resume the
 *      original transcript with a fresh fork) so a new pty.sock appears, then
 *      runAttach to it. Port of ant `V__` (4952.js) — the respawn produces
 *      another bg worker, NOT a foreground REPL. The previous ccb behaviour
 *      (spawnSync a fresh ccb inheriting the TTY) was ccb-invented and WRONG:
 *      it dropped the user into a brand-new "Welcome back" session whenever the
 *      forked worker's own transcript wasn't on disk yet, AND its foreground
 *      REPL stole the tty (a second source of the cooked-echo `^[[C` garbage,
 *      since stdin raw mode is released during the ink unmount that precedes
 *      this call). Removed entirely.
 *
 * NOTE: pause/suspendStdin/resume is gone — the caller (agentsFleet.ts
 * loop) unmounts the FleetView Ink root BEFORE calling this and mounts
 * a fresh one AFTER. That gives the inner REPL a clean terminal and
 * avoids the frame-buffer drift that broke the return-to-FleetView path.
 */

import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Source: ant 4774.js spare-ready loop uses 10s budget (`Date.now() + 10_000`).
 * Worker boot path: bun-boot (~300ms with embedded files) + bundle eval
 * (~200ms) + Bun.Terminal + Bun.spawn inner + server.listen — total
 * ~500ms-1s on warm runs, occasionally up to 3s on cold disk. 10s is
 * generous enough to never spuriously fall to slow-path while still
 * giving up on truly broken spawns.
 */
const PTY_SOCK_WAIT_BUDGET_MS = 10_000

function getJobsRoot(): string {
  const root = process.env.CLAUDE_CONFIG_HOME
  return root ? join(root, 'jobs') : join(homedir(), '.claude', 'jobs')
}

function getJobDir(short: string): string {
  return join(getJobsRoot(), short)
}

function readWholeFile(path: string): string {
  const stat = statSync(path)
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(stat.size)
    readSync(fd, buf, 0, buf.length, 0)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

interface BgMeta {
  ptySocket?: string
}

interface FleetState {
  cwd?: string
  respawnFlags?: readonly string[]
  /** Optional display name (ant `name` field — set via /rename). */
  name?: string
  /** Initial dispatch prompt — fallback when name is missing. */
  intent?: string
  /** Source: ant GsH `K.sessionId` — original dispatch session id. */
  sessionId?: string
  /** Source: ant GsH `$.resumeSessionId ?? K.sessionId` — set by the
   *  worker's own resume bookkeeping. ant uses this when present. */
  resumeSessionId?: string
}

function readMeta(short: string): BgMeta | null {
  const path = join(getJobDir(short), 'meta.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readWholeFile(path)) as BgMeta
  } catch {
    return null
  }
}

function readFleetState(short: string): FleetState | null {
  const path = join(getJobDir(short), 'state.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readWholeFile(path)) as FleetState
  } catch {
    return null
  }
}

export async function fleetAttach(short: string): Promise<void> {
  const meta = readMeta(short)
  const state = readFleetState(short)
  const jobDir = getJobDir(short)

  const ptySocketPath = meta?.ptySocket ?? join(jobDir, 'pty.sock')

  // Source: ant 5092.js Ot3 — `process.stdout.write(dD(ZY.SET_TITLE_AND_ICON,
  // vZ6(f.job.state, true)))` updates the terminal window/tab title to
  // the job's label whenever an attach launches. Lets users tell tabs
  // apart at a glance (`hi (a31abc44)` instead of `bash`).
  const labelForTitle = (state?.name ?? state?.intent ?? short).trim() || short
  process.stdout.write(`\x1b]0;${labelForTitle.slice(0, 80)}\x07`)

  // Source: ant 5092.js Ot3 — `W = f.respawnResult ?? await kZ6(f.job.id, ...)`.
  // For fresh dispatches, ant's kZ6 gives the worker time to become
  // reachable before attach. ccb mirrors by polling for pty.sock.
  //
  // Why poll instead of respawning immediately: spawnBgPty's spawnPtyHost
  // fork is synchronous but the bg-pty-host child still has to bun-boot
  // + bundle-eval + create Bun.Terminal + server.listen — ~500ms-1s on
  // warm cache, up to ~3s cold. Without a poll, fresh-dispatch +
  // right-arrow within that window would see `existsSync(pty.sock) === false`
  // and respawn an already-booting worker. Poll first; respawn only when
  // the socket genuinely never appears.
  //
  // Heuristic: if meta.json was written (= ccb dispatched a worker),
  // the pty.sock IS coming — poll. Otherwise (orphan with only
  // state.json), go straight to respawn.
  let hasLivePty = existsSync(ptySocketPath)
  if (!hasLivePty && meta !== null) {
    const deadline = Date.now() + PTY_SOCK_WAIT_BUDGET_MS
    while (Date.now() < deadline) {
      if (existsSync(ptySocketPath)) {
        hasLivePty = true
        break
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  if (hasLivePty) {
    const { runAttach } = await import('../bg/attachClient.js')
    // Let runAttach errors propagate — the agentsFleet loop catches them into
    // `initialError` and shows a toast on remount (ant Ot3). Do NOT swallow +
    // fall to a foreground spawn (the old bug).
    await runAttach(ptySocketPath, short)
    return
  }

  // DEAD/ORPHANED — no live PTY worker. Respawn through the daemon (ant
  // `V__`, 4952.js): produce ANOTHER bg worker (resuming the original
  // transcript with a fresh fork) so a new pty.sock appears, then attach to
  // it. NEVER spawn a foreground REPL — ant has no such path, and one would
  // both land the user in the wrong session and steal the tty (cooked-echo
  // `^[[C`).
  await respawnThenAttach(short, state)
}

/**
 * Respawn a dead worker through the daemon and attach to its fresh PTY socket.
 * Port of ant `V__` (4952.js): the respawn rebuilds `--resume <id>
 * --fork-session` from state.json (`resumeSessionId ?? sessionId`, gated on the
 * transcript existing) and dispatches a new bg worker via spawnBgPty. Throws if
 * the respawn can't produce a reachable socket — the caller turns that into a
 * FleetView error toast (ant Ot3 `J = k.msg`).
 */
async function respawnThenAttach(
  short: string,
  state: FleetState | null,
): Promise<void> {
  if (state === null) {
    throw new Error(`session ${short} is gone (no saved state to respawn)`)
  }
  const cwd = state.cwd ?? process.cwd()
  // ant V__: `w = $.resumeSessionId ?? K.sessionId`. For the left-arrow bridge
  // resumeSessionId is the ORIGINAL foreground session (its transcript is on
  // disk); sessionId is the forked worker id (may not be flushed). Prefer the
  // former — it's what makes the respawn inherit the conversation instead of
  // booting blank.
  const resumeSessionId = state.resumeSessionId ?? state.sessionId
  const resumeArgs =
    resumeSessionId !== undefined && resumeSessionId !== ''
      ? buildResumeArgsIfTranscriptExists(cwd, resumeSessionId)
      : []
  // ant i1O: `--resume` always pairs with `--fork-session` so the respawn gets
  // a fresh id and never contends with the original transcript's file.
  const forkFlags = resumeArgs.length > 0 ? ['--fork-session'] : []
  const flags = [...resumeArgs, ...forkFlags, ...(state.respawnFlags ?? [])]

  const { spawnBgPty } = await import('../bg.js')
  // Reuse the SAME short so the FleetView row, job dir, and new socket all
  // stay in sync (ant keeps the daemonShort stable across respawn). Empty
  // directive: a --resume worker inherits its transcript and must NOT re-run a
  // prompt (same invariant as the left-arrow spawn). Poll long enough for the
  // worker to bind its socket.
  const { socketPath } = await spawnBgPty({
    short,
    flags,
    directive: '',
    cwd,
    quiet: true,
    waitForSocketMs: PTY_SOCK_WAIT_BUDGET_MS,
  })

  if (!existsSync(socketPath)) {
    throw new Error(`couldn't restart session ${short} (worker never came up)`)
  }
  const { runAttach } = await import('../bg/attachClient.js')
  await runAttach(socketPath, short)
}

/**
 * Source: ant 4774.js GsH transcript-exists gate:
 *   let j = path.join(I2(await Qz(K.cwd)), `${w}.jsonl`)
 *   let J = await qOH(j)
 *   let f = [...J ? ["--resume", w] : [], ...]
 *
 * ccb's projects dir derivation mirrors ant `I2`: replace path separators
 * with `-` then prefix `~/.claude/projects/`. The slow-path attach uses
 * --resume only when the transcript file actually exists on disk; missing
 * transcript means fresh REPL (ant's same fallback).
 */
function buildResumeArgsIfTranscriptExists(
  cwd: string,
  sessionId: string,
): readonly string[] {
  try {
    const root = process.env.CLAUDE_CONFIG_HOME ?? join(homedir(), '.claude')
    const projectsDir = join(root, 'projects')
    const slug = cwd.replace(/[/\\]/g, '-').replace(/^-/, '-')
    const transcript = join(projectsDir, slug, `${sessionId}.jsonl`)
    return existsSync(transcript) ? ['--resume', sessionId] : []
  } catch {
    return []
  }
}
