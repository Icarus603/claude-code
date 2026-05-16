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

  for (;;) {
    const root = await createRoot({ exitOnCtrlC: false })

    const action: FleetAction = await new Promise<FleetAction>(resolve => {
      void mountFleetView({
        currentSessionId: process.env.CLAUDE_SESSION_ID ?? '',
        initialFocusedShort: lastFocusedShort,
        root,
        onDispatch: info => {
          // Async-fire spawnBgPty; row surfaces via state.json polling.
          // quiet:true — outer Ink owns the screen, don't print banner.
          // Source: ant 5092.js Ot3 → on8 parse result feeds iP6:
          //   - `template.name` becomes the --agent flag value
          //   - `cwd` overrides spawn cwd (from @repo mention)
          // ccb mirrors with `--agent <name>` when info.agent is set
          // and uses info.cwd if specified, falling back to getCwd().
          const flags: string[] = info.agent
            ? ['--agent', info.agent]
            : []
          void spawnBgPty({
            flags,
            directive: info.intent,
            cwd: info.cwd ?? getCwd(),
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

    if (action.type === 'quit') return

    try {
      // runAttach paints into the same alt-screen buffer we just
      // handed off. It writes `\x1b[2J\x1b[H` to clear (mirroring
      // ant's PzH() clear+home) and the inner REPL's data fills it.
      await fleetAttach(action.short).catch(err =>
        process.stderr.write(`attach failed: ${(err as Error).message}\n`),
      )
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
