/**
 * Bg-session spare pool — keep one pre-booted ccb REPL idling at empty
 * prompt so the next `ccb agents` dispatch claims it INSTANTLY instead
 * of paying the ~1-2s bun-boot + bundle-load + first-render cost.
 *
 * Source: ant 4774.js spare-pool subsystem (verbatim port):
 *
 *   s1H = singleton spare slot ({jobId, sessionId, cwd, ready, defaults})
 *   ZsH = in-flight ensure-spare promise (debounce concurrent calls)
 *   nP6 = disabled flag (set on quit so a late spawn doesn't strand)
 *
 *   function rP6(cwd, fromMount, defaults) {        // ensureSpare
 *     if (fromMount) nP6 = false
 *     if (s1H || ZsH || nP6) return
 *     if (lowMem()) return
 *     let { sessionId, short } = freshIds()
 *     ZsH = (async () => {
 *       let r = await m_H(['--agent', 'claude', ...], sessionId, "spare", cwd)
 *       if (!r.ok) return cleanup()
 *       if (nP6) return cleanup()            // disabled mid-spawn
 *       s1H = { jobId: short, sessionId, cwd, ready: false, defaults }
 *     })()
 *     await ZsH
 *     ZsH = undefined
 *   }
 *
 *   function yvK(intent) {                          // claimSpare
 *     let s = s1H; s1H = undefined
 *     if (!s) return null                           // caller cold-spawns
 *     let state = patchState(stateFor(s), intent)
 *     await sendReplyToSpare(s.jobId, intent)       // inject via daemon reply
 *     await writeJobState(s.jobId, state)
 *     return { ok: true, jobId: s.jobId, sessionId: s.sessionId }
 *   }
 *
 *   // dispatch site fires `rP6(cwd, false, A)` again after every claim
 *   // so the pool refills for the NEXT dispatch.
 *
 * ccb implementation parallels ant:
 *   - ensureSpare(cwd) is idempotent + concurrency-safe via inflight guard
 *   - claimSpare(cwd) returns the slot if cwd matches, else undefined
 *   - sendClaim(socketPath, intent) connects to the spare's pty.sock,
 *     sends a CTRL `{t:'claim', intent}` frame (already handled by
 *     ptyHost which writes `intent + '\n'` to the inner REPL's stdin),
 *     then disconnects.
 *   - rewriteSpareState patches the state.json from the spare's
 *     "idle/no-intent" shape into a real dispatched job shape.
 *   - disableSparePool() shuts everything down on FleetView quit so a
 *     spare that boots after exit doesn't leak.
 */

import { connect } from 'node:net'
import { existsSync } from 'node:fs'

import { readEnv } from '@claude-code/config/env'
import {
  invalidateCache,
  readJobState,
  writeJobState,
} from '@claude-code/agent/background/fleet/fleetStore.js'
import type { FleetJobState } from '@claude-code/agent/background/fleet/fleetTypes.js'

import { encodeCtrlFrame } from './ptyFrame.js'

interface SpareSlot {
  short: string
  cwd: string
  socketPath: string
}

let spare: SpareSlot | undefined
let ensureInflight: Promise<void> | undefined
let disabled = false

/**
 * Source: ant 4771.js `wvK()` + `VZ_()` low-memory guard — refuses to
 * spawn a spare when free RAM drops below the threshold.
 *
 *   function VZ_(){
 *     if (d_()==="macos") return 0;
 *     return Z_("tengu_bg_low_mem_mb", 1024) * 1024 * 1024;
 *   }
 *   function wvK(){
 *     let H = VZ_();
 *     return H>0 && YvK.freemem() < H;
 *   }
 *
 * macOS exempted because `os.freemem()` doesn't line up with vm_stat
 * (would cause spurious retires). Linux/Windows: default 1024 MB,
 * overridable via CLAUDE_CODE_BG_LOW_MEM_MB env (matches the daemon's
 * NdK port at bgDaemon.ts:355 — same env, same default).
 */
function lowMemory(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os')
  if (os.platform() === 'darwin') return false
  const envOverride = Number(readEnv('CLAUDE_CODE_BG_LOW_MEM_MB'))
  const thresholdMb = Number.isFinite(envOverride) && envOverride > 0
    ? envOverride
    : 1024
  const thresholdBytes = thresholdMb * 1024 * 1024
  return os.freemem() < thresholdBytes
}

/**
 * Kill a spare worker — daemon kill (best-effort) + remove its on-disk
 * job dir. Spares are NEVER user-visible jobs so a hard cleanup is fine
 * (no "row vanished" concern). Mirrors ant `u_H(jobId, {internal:true})`.
 */
async function killSpareWorker(short: string): Promise<void> {
  const { daemonKill } = await import('./daemonAdapter.js')
  await daemonKill({ short }).catch(() => undefined)
  const { deleteJobDir } = await import(
    '@claude-code/agent/background/fleet/fleetStore.js'
  )
  await deleteJobDir(short).catch(() => undefined)
}

/**
 * Spawn a spare worker in the background. Source: ant `rP6`.
 *
 * - Idempotent: if a spare already exists or one is being spawned,
 *   returns the existing promise without starting another.
 * - Disabled-safe: if `disableSparePool()` was called mid-spawn, the
 *   newly spawned worker is killed instead of being slotted.
 * - The spare is spawned with `directive=''` so the inner REPL boots
 *   to an idle prompt instead of auto-submitting a first turn.
 */
export async function ensureSpare(cwd: string): Promise<void> {
  if (disabled || spare !== undefined) return
  if (ensureInflight !== undefined) return ensureInflight
  if (lowMemory()) return

  ensureInflight = (async () => {
    try {
      const { spawnBgPty } = await import('../bg.js')
      const r = await spawnBgPty({
        directive: '',
        cwd,
        // Spare must be reachable for claim — wait up to 5s for pty.sock.
        // Caller (ensureSpare) doesn't await this; if dispatch races, the
        // claim path will see undefined and cold-spawn fall through.
        waitForSocketMs: 5_000,
        quiet: true,
      })
      if (disabled) {
        // Aborted mid-spawn — kill the worker we just spawned so it
        // doesn't strand.
        await killSpareWorker(r.short).catch(() => undefined)
        return
      }
      // Wait for the inner REPL to write `spare-ready.flag` (REPLView's
      // mount effect with CCB_SPARE=1). Source: ant 4774.js — spare's
      // `ready` flag is set when daemon roster reports the spare. ccb
      // has no roster; we use a marker file. Until the inner REPL is
      // mounted (PromptInput's useInput registered), bracketed-paste
      // sent to its PTY is dropped — that was the "REPL is empty after
      // attach" bug.
      const { join } = await import('node:path')
      const { getJobDir } = await import(
        '@claude-code/agent/background/fleet/fleetStore.js'
      )
      const markerPath = join(getJobDir(r.short), 'spare-ready.flag')
      const readyDeadline = Date.now() + 10_000
      while (Date.now() < readyDeadline) {
        if (existsSync(markerPath)) break
        if (disabled) {
          await killSpareWorker(r.short).catch(() => undefined)
          return
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      if (disabled) {
        await killSpareWorker(r.short).catch(() => undefined)
        return
      }
      spare = {
        short: r.short,
        cwd,
        socketPath: r.socketPath,
      }
    } catch {
      // Best-effort. Caller doesn't need to know.
    } finally {
      ensureInflight = undefined
    }
  })()

  return ensureInflight
}

/**
 * Claim the spare if it matches the requested cwd. Returns the slot
 * (caller is responsible for sending the intent + rewriting state.json
 * + re-ensuring) or `undefined` if no compatible spare is available.
 *
 * Source: ant `yvK` — synchronous take of the singleton + cwd match.
 * The cwd check ensures we don't hand a spare booted in repo A to a
 * dispatch targeting repo B (state.json carries cwd; the inner REPL's
 * file picker / git context also depend on cwd at spawn time).
 */
export function claimSpare(cwd: string): SpareSlot | undefined {
  if (spare === undefined) return undefined
  if (spare.cwd !== cwd) return undefined
  if (!existsSync(spare.socketPath)) {
    // Stale — host process died. Drop and refuse.
    spare = undefined
    return undefined
  }
  const claimed = spare
  spare = undefined
  return claimed
}

/**
 * Read-only peek at the current spare slot — used by FleetView dispatch
 * to pre-allocate the optimistic row's short id so it agrees with the
 * worker's real short. Source: ant 5092.js `let AP = Cg8()` — sync
 * read of the singleton, no consumption.
 */
export function peekSpareSlot(cwd: string): SpareSlot | undefined {
  if (spare === undefined) return undefined
  if (spare.cwd !== cwd) return undefined
  if (!existsSync(spare.socketPath)) return undefined
  return spare
}

/**
 * Send a CTRL `claim` frame to the spare's pty.sock. The ptyHost
 * handles it by writing `intent + '\n'` to the inner REPL's stdin,
 * which the REPL reads as if the user had typed and submitted.
 *
 * Source: ant `cP6(jobId, intent)` uses the daemon's `reply` op; ccb's
 * ptyHost accepts the same frame type directly over the worker's Unix
 * socket, no daemon needed.
 */
export async function sendClaim(
  socketPath: string,
  intent: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const sock = connect(socketPath)
    let settled = false
    const settle = (err?: Error): void => {
      if (settled) return
      settled = true
      try {
        sock.destroy()
      } catch {
        /* best-effort */
      }
      if (err) reject(err)
      else resolve()
    }
    sock.once('error', settle)
    sock.once('connect', () => {
      try {
        sock.write(encodeCtrlFrame({ t: 'claim', intent }))
        // Give the frame a tick to flush before destroying.
        setTimeout(() => settle(), 50)
      } catch (err) {
        settle(err as Error)
      }
    })
  })
}

/**
 * After claiming the spare we need to rewrite its state.json so the
 * FleetView polling tick surfaces it with the user's intent + a proper
 * name (extracted from intent), instead of the "blank dispatch" the
 * spare booted with.
 *
 * Source: ant `K = PsH(_7H({...spare, intent}), intent)` then
 * `await UT(jobDir, K)`.
 *
 * Because spawnBgPty's optimistic state.json write is SKIPPED for
 * spare (directive===""), the file does NOT exist at claim time —
 * the spare worker's own `useBgFleetStateSync` only writes state.json
 * on the first isLoading transition, which happens AFTER the claim
 * frame's `intent + '\n'` reaches the REPL. So this function writes
 * the initial state.json from scratch using the spare's identity +
 * the user's intent. Same shape as `writeOptimisticFleetState` in
 * bg.ts (kept in sync — both follow ant `iP6` 4774.js:93-148).
 */
export async function rewriteSpareState(
  short: string,
  intent: string,
  cwd: string,
): Promise<void> {
  const { join } = await import('node:path')
  const { homedir } = await import('node:os')
  const root = process.env.CLAUDE_CONFIG_HOME ?? join(homedir(), '.claude')
  const jobDir = join(root, 'jobs', short)
  invalidateCache(jobDir)
  const now = new Date().toISOString()
  // Single-line label from intent, capped at 60 chars. Mirrors
  // writeOptimisticFleetState's `label` derivation in bg.ts.
  const label = intent.split(/\r?\n/)[0]!.slice(0, 60).trim() || 'session'
  const current = await readJobState(jobDir).catch(() => null)
  const base: FleetJobState =
    current !== null
      ? current
      : {
          state: 'working',
          tempo: 'active',
          detail: label,
          output: null,
          children: null,
          linkScanOffset: 0,
          template: 'bg',
          respawnFlags: [],
          intent,
          name: label,
          nameSource: 'auto',
          initialPrompt: intent,
          sessionId: '',
          daemonShort: short,
          cwd,
          createdAt: now,
          updatedAt: now,
          firstTerminalAt: null,
          backend: 'daemon',
        }
  const next: FleetJobState = {
    ...base,
    intent,
    name: base.name ?? label,
    initialPrompt: base.initialPrompt ?? intent,
    detail: base.detail || label,
    updatedAt: now,
  }
  await writeJobState(jobDir, next).catch(() => undefined)
}

/**
 * Tear down the spare on FleetView quit. Source: ant `hvK` — sets the
 * disabled flag AND kills the existing spare so a "ccb agents → quit
 * → relaunch" cycle doesn't leak a worker.
 */
export async function disableSparePool(): Promise<void> {
  disabled = true
  if (ensureInflight !== undefined) {
    await ensureInflight.catch(() => undefined)
  }
  const s = spare
  spare = undefined
  if (s !== undefined) {
    await killSpareWorker(s.short).catch(() => undefined)
  }
}

/**
 * Re-enable spare creation after `disableSparePool` (e.g. a second
 * `ccb agents` invocation in the same process). Source: ant `rP6`'s
 * `if (fromMount) nP6 = false` branch.
 */
export function enableSparePool(): void {
  disabled = false
}
