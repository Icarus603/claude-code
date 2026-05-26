/**
 * Start the rendezvous (control) server inside a bg-worker REPL.
 *
 * This is the inner-REPL half of the rv channel (ant 4291.js). It runs
 * ONLY in a bg worker that was spawned with `CLAUDE_BG_RENDEZVOUS_SOCK`
 * set (spawnPty.ts) — i.e. the daemon-supervised PTY path. The server
 * gives the worker an out-of-band channel to its supervisor that ccb
 * previously lacked:
 *
 *   - An UNCONDITIONAL 30s heartbeat. This is the real gap ccb had: the
 *     PTY-ctrl heartbeat (ptyHost.ts) only fires when a client is attached
 *     (`clients.size > 0`), so an UNATTACHED bg worker sent no liveness
 *     signal at all and the supervisor's stall watchdog ran on pid-poll
 *     alone. The rv heartbeat fires regardless of attach state.
 *   - A startup-wedge watchdog: a worker that boots but never starts its
 *     first turn (blocked on a setup/onboarding dialog the supervisor
 *     can't see) is surfaced as `blocked` instead of sitting silently.
 *     Disarmed here the moment the first turn begins.
 *
 * The authoritative `state` / `done` pushes are fired from
 * useBgFleetStateSync (which already owns the state.json writes) so the
 * two hooks don't double-write disk — see that file's sendRv calls.
 *
 * Gated on `CLAUDE_CODE_SESSION_KIND === 'bg'` AND the rv socket env. The
 * server itself no-ops if the env var is unset, but we also gate here to
 * avoid importing the rv module in the foreground REPL hot path.
 */

import { useEffect, useRef } from 'react'

export function useBgRendezvousServer(isLoading: boolean): void {
  const startedRef = useRef(false)
  const disarmedRef = useRef(false)

  // Start the server once on mount (bg + rv-sock gated).
  useEffect(() => {
    if (process.env.CLAUDE_CODE_SESSION_KIND !== 'bg') return
    if (!process.env.CLAUDE_BG_RENDEZVOUS_SOCK) return
    if (startedRef.current) return
    startedRef.current = true

    let stop: (() => void) | undefined
    void (async () => {
      try {
        const { startRendezvousServer, stopRendezvousServer } = await import(
          '@claude-code/agent/background/fleet/rvServer.js'
        )
        await startRendezvousServer({
          // The renderer is up by the time this effect runs (we're inside a
          // mounted REPL component), so the startup-settle gate is satisfied.
          isRendererReady: () => true,
          // Graceful shutdown: the supervisor asked us to stop. Exit cleanly
          // so the PTY host tears down and the job settles 'done'. We keep
          // this minimal — a fuller teardown (session archive flush) would
          // hook the REPL's existing exit path, but process.exit(0) matches
          // ant's fallback timing and lets the pty-host exit-frame fire.
          onShutdown: () => {
            try {
              stopRendezvousServer()
            } catch {
              // best-effort
            }
            // Give the 'shutting-down' ack a tick to flush, then exit.
            setTimeout(() => process.exit(0), 100).unref()
          },
        })
        stop = stopRendezvousServer
      } catch {
        // best-effort — rv is an optimisation over pid-poll, never required.
      }
    })()

    return () => {
      try {
        stop?.()
      } catch {
        // best-effort
      }
    }
  }, [])

  // Disarm the startup-wedge watchdog the first time a turn starts —
  // proof the worker is doing real work, not stuck on a boot dialog.
  useEffect(() => {
    if (!isLoading) return
    if (disarmedRef.current) return
    disarmedRef.current = true
    void (async () => {
      try {
        const { disarmStartupWedgeWatchdog } = await import(
          '@claude-code/agent/background/fleet/rvServer.js'
        )
        disarmStartupWedgeWatchdog()
      } catch {
        // best-effort
      }
    })()
  }, [isLoading])
}
