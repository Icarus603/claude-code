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
import { connect } from 'node:net'
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

/**
 * Connect-probe backoff (ms). Source: ant 5472.js `vf4` spare-claim backoff
 * — `[50,100,150,200,250,300,400,500,500,500]`. Progressive ramp: tight at the
 * start so a worker that finishes booting early is reached within ~50-150ms
 * (vs the old file-poll's flat 50ms tick that also waited on the file
 * *appearing*, not on the socket *accepting*), loosening to 500ms so a slow
 * cold-disk boot doesn't spin the event loop. Repeats the last entry until the
 * budget is exhausted.
 */
const CONNECT_BACKOFF_MS = [
  50, 100, 150, 200, 250, 300, 400, 500, 500, 500,
] as const

/**
 * Probe whether the worker's PTY socket is ACCEPTING connections (not merely
 * that the socket *file* exists). Mirrors ant's attach model: ant never polls
 * `fs.existsSync(sock)` — its attach client `dc` (4945.js) does a direct
 * `net.connect(sock)`, and the orchestrator (`$nK` 4951.js, `aM3` 4957.js)
 * retries the connect on `ENOENT`/`ECONNREFUSED` with a backoff until the
 * worker is reachable or the budget is spent. A successful `connect` event is
 * the precise readiness signal — it fires the instant the worker's
 * `server.listen()` is accepting, with no listen→accept window and no
 * fixed-tick latency that file-existence polling adds.
 *
 * Resolves true the moment a probe connection succeeds (then immediately
 * destroys it — runAttach opens its own adopter connection). Resolves false if
 * the budget is exhausted without a successful connect.
 */
async function waitForSocketAccepting(
  socketPath: string,
  budgetMs: number,
): Promise<boolean> {
  const probeConnect = (): Promise<boolean> =>
    new Promise<boolean>(resolve => {
      const sock = connect(socketPath)
      let settled = false
      const done = (ok: boolean): void => {
        if (settled) return
        settled = true
        try {
          sock.destroy()
        } catch {
          /* best-effort */
        }
        resolve(ok)
      }
      sock.once('connect', () => done(true))
      sock.once('error', () => done(false))
    })

  const deadline = Date.now() + budgetMs
  let attempt = 0
  for (;;) {
    // Always probe at least once (budgetMs=0 → single fast try).
    if (await probeConnect()) return true
    // Not accepting yet (ENOENT = socket file absent / ECONNREFUSED = bound but
    // not yet listening). Back off and retry — ant `$nK`/`aM3` retry loop.
    const delay =
      CONNECT_BACKOFF_MS[Math.min(attempt, CONNECT_BACKOFF_MS.length - 1)]!
    attempt++
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await new Promise(resolve => setTimeout(resolve, Math.min(delay, remaining)))
  }
}

/**
 * READY-GATE for the FleetView attach switch. Source: ant 5277.js I0 (2560) —
 * pressing → on a row sets `aH(id)` (the row renders "opening…") and then
 * `await dy6(id)` (the ready-gate) resolves BEFORE `H({type:"open"})` switches
 * into attach. The "opening…" indicator is visible for exactly the dy6 await.
 *
 * ant's dy6/V__ gate resolves on worker PROCESS reachability (the daemon is
 * already connected to the worker's rv/pty and knows its state). ccb is
 * daemon-less and the user's complaint is specifically the COLD worker
 * (left-arrow → IMMEDIATE right-arrow, worker still in its ~415ms boot→first-
 * render): switching then lands on an empty ring = black screen. So ccb's gate
 * waits for the worker to actually EMIT its first rendered frame — connect to
 * pty.sock, read the ring replay + live output, resolve the instant a chunk
 * contains the worker's first-render marker (`\x1b[2J` = ant gW, or
 * `\x1b[H\x1b[2K` = ant P). A WARM worker (ring already holds a frame) resolves
 * on the first replayed chunk → instant switch, no visible "opening…", exactly
 * like ant. A COLD worker keeps the FleetView row showing "opening…" until its
 * first frame lands, THEN switches — never a black screen.
 *
 * The probe connection is disposed before returning; runAttach opens its own.
 * Resolves on first-frame OR budget exhaustion (switch anyway — runAttach's own
 * ring replay + the loop's error toast handle a truly-dead worker).
 */
export async function waitForWorkerFirstFrame(
  socketPath: string,
  budgetMs: number,
): Promise<void> {
  // Reachability first (socket may not be accepting yet for a just-forked
  // worker). Cheap connect-probe with backoff; if it never accepts, bail and
  // let the switch proceed (runAttach will surface the failure).
  if (!(await waitForSocketAccepting(socketPath, budgetMs))) return
  const remaining = budgetMs // reachability is usually instant; reuse budget
  const { createPtyAdopter } = await import('../bg/ptyAdopter.js')
  const FRAME_MARKERS = [Buffer.from('\x1b[2J'), Buffer.from('\x1b[H\x1b[2K')]
  await new Promise<void>(resolve => {
    const adopter = createPtyAdopter(socketPath)
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        sub.dispose()
        exitSub.dispose()
        adopter.dispose()
      } catch {
        /* best-effort */
      }
      resolve()
    }
    const sub = adopter.onData(chunk => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'binary')
      if (FRAME_MARKERS.some(m => buf.includes(m))) finish()
    })
    // If the worker exits before a frame, stop waiting.
    const exitSub = adopter.onExit(() => finish())
    const timer = setTimeout(finish, Math.max(0, remaining))
    timer.unref()
  })
}

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

  // Wait for the worker to be REACHABLE before attaching — ant's model, not
  // file-existence polling. ant never `fs.existsSync(sock)`-polls: its attach
  // orchestrator (`$nK` 4951.js / `aM3` 4957.js) retries `net.connect(sock)` on
  // ENOENT/ECONNREFUSED with a backoff until the worker's `server.listen()` is
  // accepting. A successful connect is the exact readiness edge — it fires the
  // instant the worker accepts, with no listen→accept gap and no fixed-tick
  // latency that `existsSync` adds (the file appears at bind time, before the
  // socket accepts; the old 50ms poll then waited a further tick).
  //
  // Fresh dispatch: spawnPtyHost's fork is synchronous but the bg-pty-host
  // child still bun-boots + bundle-evals + creates Bun.Terminal + listens
  // (~500ms-1s warm, up to ~3s cold). The connect-probe tolerates that window
  // exactly like ant. Heuristic unchanged: meta.json written (= ccb dispatched
  // a worker) means the socket IS coming, so probe; an orphan with only
  // state.json goes straight to respawn.
  let reachable = await waitForSocketAccepting(ptySocketPath, 0) // fast first try
  if (!reachable && meta !== null) {
    reachable = await waitForSocketAccepting(
      ptySocketPath,
      PTY_SOCK_WAIT_BUDGET_MS,
    )
  }

  if (reachable) {
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
  // Respawn fire-and-forget (waitForSocketMs:0) — the connect-probe below owns
  // the readiness wait, same as the fresh-dispatch path. Using spawnBgPty's own
  // file-poll here would double-wait (file appears, then we'd still connect-probe).
  const { socketPath } = await spawnBgPty({
    short,
    flags,
    directive: '',
    cwd,
    quiet: true,
    waitForSocketMs: 0,
  })

  // ant `V__` (4952.js) respawn waits for the new worker to be REACHABLE via
  // connect-retry, not file existence. Same probe as the fresh-dispatch path.
  if (!(await waitForSocketAccepting(socketPath, PTY_SOCK_WAIT_BUDGET_MS))) {
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
