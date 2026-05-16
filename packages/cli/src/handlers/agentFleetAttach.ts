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
 * Two paths in ccb:
 *   1. Live PTY socket (meta.ptySocket or <jobDir>/pty.sock exists, OR
 *      appears within budget): runAttach connects to it. Sub-100ms once
 *      the socket is live. Used for fresh dispatches + existing alive
 *      workers.
 *   2. Truly orphaned (state.json exists but no meta.json or socket
 *      after polling): spawn a fresh ccb REPL inheriting the user's TTY
 *      via spawnSync. This is the "old job — start a new conversation
 *      in this cwd" fallback.
 *
 * NOTE: pause/suspendStdin/resume is gone — the caller (agentsFleet.ts
 * loop) unmounts the FleetView Ink root BEFORE calling this and mounts
 * a fresh one AFTER. That gives the inner REPL a clean terminal and
 * avoids the frame-buffer drift that broke the return-to-FleetView path.
 */

import { spawnSync } from 'node:child_process'
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

function buildCcbArgv(extraArgs: readonly string[]): { cmd: string; args: string[] } {
  const isBun = process.argv0.endsWith('bun')
  if (isBun) {
    const cliJs = process.argv[1] ?? ''
    return { cmd: process.argv0, args: [cliJs, ...extraArgs] }
  }
  return { cmd: process.argv[0]!, args: [...extraArgs] }
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
  // Why poll instead of slow-spawn immediately: spawnBgPty's spawnPtyHost
  // fork is synchronous but the bg-pty-host child still has to bun-boot
  // + bundle-eval + create Bun.Terminal + server.listen — ~500ms-1s on
  // warm cache, up to ~3s cold. Without a poll, fresh-dispatch +
  // right-arrow within that window saw `existsSync(pty.sock) === false`
  // and fell to the spawnSync slow path → ANOTHER ~1-2s bun boot + a
  // brand-new REPL that DIDN'T attach to the bg worker we just
  // dispatched. The user perceives 2-4s of dead time and lands in the
  // wrong REPL.
  //
  // Heuristic: if meta.json was written (= ccb dispatched a worker),
  // the pty.sock IS coming — poll. Otherwise (orphan with only
  // state.json), fall straight through to slow-path.
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
    try {
      const { runAttach } = await import('../bg/attachClient.js')
      await runAttach(ptySocketPath, short)
      return
    } catch (err) {
      process.stderr.write(`pty attach failed: ${(err as Error).message}\n`)
      // Fall through to spawnSync path.
    }
  }

  // SLOW path — no live PTY worker. Spawn a fresh ccb REPL inheriting
  // the user's TTY. CCB_FLEET_ATTACH_CHILD lets the child REPL detect
  // it's a FleetView attach handoff (left-arrow on empty exits cleanly).
  const cwd = state?.cwd ?? process.cwd()
  const flags = state?.respawnFlags ?? []
  const { cmd, args } = buildCcbArgv([...flags])
  spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, CCB_FLEET_ATTACH_CHILD: '1' },
  })
}
