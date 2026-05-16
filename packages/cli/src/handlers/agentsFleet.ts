/**
 * `ccb agents` CLI handler.
 *
 * Source: ant 5092.js `Ot3` (FleetView entry handler at v2.1.143). ant
 * runs FleetView in a `for (;;)` loop: each iteration mounts a fresh
 * Ink root, awaits a user action (attach, dispatch-and-attach, or
 * quit), unmounts the root BEFORE running attach, then creates a NEW
 * root on the next loop iteration to remount FleetView. Critically NOT
 * pause/resume — pausing leaks the inner REPL's terminal state into
 * the outer's Ink frame buffer and corrupts the redraw on return.
 *
 * Loop sketch (ant Ot3):
 *   for (;;) {
 *     let action = await new Promise(resolve => root.render(<FleetView onAction={resolve}/>))
 *     if (isFullscreen && action.type==="open") inkInstance.handoffAltScreen()
 *     if (!isFullscreen) root.render(null)
 *     root.unmount()
 *     if (action.type === "done") break
 *     await attach(action.job.id)
 *     if (!isFullscreen) process.stdout.write(PzH())  // alt-screen re-enter
 *     root = await createRoot({exitOnCtrlC: false})
 *   }
 */

import { feature } from 'bun:bundle'

import { agentsHandler as plainTextHandler } from './agents.js'

type FleetAction =
  | { type: 'quit' }
  | { type: 'attach'; short: string }

export async function agentsFleetHandler(): Promise<void> {
  if (!feature('AGENTS_FLEET')) {
    return plainTextHandler()
  }
  if (process.stdout.isTTY !== true || process.stdin.isTTY !== true) {
    return plainTextHandler()
  }

  // Eagerly load the attach module too — dynamic-import latency during
  // the right-arrow handoff (~50-100ms cold) is part of the perceived
  // "blank window" the user complained about. Pre-warming the module
  // graph here pays its cost during ccb agents boot instead.
  const [{ mountFleetView }, { createRoot }] = await Promise.all([
    import('@claude-code/repl/screens/agentFleet/mountFleetView.js'),
    import('@anthropic/ink'),
  ])
  const { spawnBgPty } = await import('@claude-code/cli/bg.js')
  const { fleetAttach } = await import('./agentFleetAttach.js')
  await import('../bg/attachClient.js')
  await import('../bg/ptyAdopter.js')
  const { getCwd } = await import('@claude-code/app-host/bootstrap/cwd.js')
  // Spare-pool wiring. Source: ant 4774.js rP6/yvK + 5092.js useEffect
  // that calls `rP6(m, true, A)` on FleetView mount. ccb fires ensure
  // here at handler start (one process == one FleetView lifetime in
  // ccb's loop model) so the spare boots in parallel with the rest of
  // the startup work, and is ready by the time the user dispatches.
  const sparePool = await import('../bg/sparePool.js')
  sparePool.enableSparePool()
  const ensureSpareForCwd = (cwd: string): void => {
    void sparePool.ensureSpare(cwd).catch(() => undefined)
  }
  // Kick off the first spare immediately. Doesn't block — the wait
  // happens in the background while FleetView mounts.
  ensureSpareForCwd(getCwd())

  const { instances } = await import('@anthropic/ink')

  // Loop: mount → wait for action → unmount → run action → repeat.
  // Source: ant 5092.js Ot3 `for (;;)` body. Each iteration mounts a
  // fresh Ink root in alt-screen via `<AlternateScreen>`; before
  // unmounting for an attach action we call `ink.handoffAltScreen()`,
  // which (per ant 2356.js) sets `isPaused=true` + `altScreenActive=false`.
  // That makes both `<AlternateScreen>`'s cleanup AND `ink.unmount()`
  // skip their `EXIT_ALT_SCREEN` writes — the alt buffer stays flipped
  // through the entire transition. runAttach paints into the same
  // alt buffer (CCB_ATTACH_OWNED_ALT_SCREEN env tells it not to toggle).

  // Carries the last-attached short across iterations. Source: ant 5092.js
  // `let z = process.env.CLAUDE_AGENTS_SELECT; … z = f.job.id` — when
  // FleetView remounts after attach, this seeds the focused row so the
  // user lands back on the session they just left (not the default
  // first row / "Working" group header).
  let lastFocusedShort: string | undefined =
    process.env.CLAUDE_AGENTS_SELECT || undefined
  // Carries an error message from the previous attach attempt so the
  // remounted FleetView can surface it as an errorToast. Source: ant
  // 5092.js Ot3 `let J; … if (k.kind === "error" && !k.ended) J = k.msg`
  // and `initialError: J` on next render.
  let initialError: string | undefined

  for (;;) {
    const root = await createRoot({ exitOnCtrlC: false })

    const errorForThisMount = initialError
    initialError = undefined

    const action: FleetAction = await new Promise<FleetAction>(resolve => {
      void mountFleetView({
        currentSessionId: process.env.CLAUDE_SESSION_ID ?? '',
        initialFocusedShort: lastFocusedShort,
        initialError: errorForThisMount,
        root,
        onDispatch: info => {
          // Source: ant 5092.js Ot3 dispatch — tries spare claim FIRST
          // when no agent/routine is specified AND cwd matches the
          // spare's cwd. Only then falls through to cold spawn.
          //
          //   let A7 = !!AP && AP.ready && !L9.matched && !L9.routine
          //            && NT === AP.cwd && $1
          //   ;(A7 ? yvK(intent) : kvK(intent, ...).then(iP6)).then(...)
          //
          // ccb mirrors: if dispatch is plain text (no @agent / no
          // --routine) and cwd matches the spare's cwd, claim it.
          // Spare was spawned with `--agent claude` (the default) so
          // it can only serve dispatches with the same default.
          const cwd = info.cwd ?? getCwd()
          const isPlainDispatch =
            info.agent === undefined || info.agent === 'claude'
          if (isPlainDispatch) {
            const slot = sparePool.claimSpare(cwd)
            if (slot !== undefined) {
              // Write state.json SYNCHRONOUSLY (await before next tick)
              // so the FleetView polling tick — which races us — sees a
              // row in this iteration, not next. ant inserts the row
              // synchronously into S7 (inflight optimistic) for the same
              // reason: user must see immediate feedback on Enter.
              void (async () => {
                try {
                  // Order: state.json first (row appears in FleetView),
                  // then claim-frame (REPL starts processing). Failure
                  // of either is logged but doesn't break the other.
                  await sparePool.rewriteSpareState(
                    slot.short,
                    info.intent,
                    cwd,
                  )
                  await sparePool.sendClaim(slot.socketPath, info.intent)
                } catch (err) {
                  process.stderr.write(
                    `spare claim failed: ${(err as Error).message}\n`,
                  )
                } finally {
                  // Replenish the pool for the next dispatch.
                  ensureSpareForCwd(cwd)
                }
              })()
              return
            }
          }
          // Cold path — no spare, or dispatch needs a non-default agent.
          // Async-fire spawnBgPty; row surfaces via state.json polling.
          const flags: string[] = info.agent
            ? ['--agent', info.agent]
            : []
          void spawnBgPty({
            flags,
            directive: info.intent,
            cwd,
            waitForSocketMs: 0,
            quiet: true,
          }).catch(err =>
            process.stderr.write(`spawn failed: ${(err as Error).message}\n`),
          )
        },
        onAttach: short => {
          resolve({ type: 'attach', short })
        },
        onQuit: () => {
          resolve({ type: 'quit' })
        },
      })
    })

    if (action.type === 'attach') {
      // Source: ant 5092.js Ot3 — `if (X && f.type==="open") P5.get(stdout)?.handoffAltScreen()`.
      // Hand off alt-screen ownership BEFORE unmounting so the cleanup
      // chain doesn't write EXIT_ALT_SCREEN.
      instances.get(process.stdout)?.handoffAltScreen()
      process.env.CCB_ATTACH_OWNED_ALT_SCREEN = '1'
      // Remember the attached short so the next FleetView mount can
      // land the focus on the same row.
      lastFocusedShort = action.short
    }
    root.render(null)
    root.unmount()

    if (action.type === 'quit') {
      // Kill any spare worker on quit so a "ccb agents → quit → quit
      // terminal" cycle doesn't leak a long-lived bg process. ant 4774.js
      // hvK does the same via `nP6 = true` + drop singleton.
      await sparePool.disableSparePool().catch(() => undefined)
      return
    }

    try {
      // runAttach paints into the same alt-screen buffer we just
      // handed off. It writes `\x1b[2J\x1b[H` to clear (mirroring
      // ant's PzH() clear+home) and the inner REPL's data fills it.
      // Capture errors into `initialError` so the next FleetView mount
      // can surface them as a toast (matches ant Ot3's `J = k.msg`
      // carried into the next iteration's BdK as `initialError={J}`).
      await fleetAttach(action.short).catch(err => {
        initialError = `attach failed — ${(err as Error).message}`
      })
    } finally {
      delete process.env.CCB_ATTACH_OWNED_ALT_SCREEN
      // Loop top creates a fresh Ink root, AlternateScreen runs its
      // mount-effect which writes `?1049h` again — but the terminal is
      // ALREADY in alt-screen (handed off, never exited), so this is a
      // no-op visually (DECSET 1049 on an already-active alt-screen is
      // idempotent). The `\x1b[2J\x1b[H` clear after gives FleetView a
      // blank canvas.
    }
  }
}
