/**
 * `ccb agents` CLI handler — mounts FleetView once and keeps it
 * mounted across attach/dispatch handoffs. Mirrors ant 5297.js + Ot3
 * (5092.js:3839) — single Ink root, callbacks run inline.
 *
 * Smooth-transition invariant: never unmount/remount the Ink root for
 * attach. Pause Ink, run the child synchronously, resume Ink. The
 * user sees FleetView "freeze" while the child boots, then the child
 * paints on top. No exit-then-enter flash.
 */

import { feature } from 'bun:bundle'

import { agentsHandler as plainTextHandler } from './agents.js'

export async function agentsFleetHandler(): Promise<void> {
  if (!feature('AGENTS_FLEET')) {
    return plainTextHandler()
  }
  if (process.stdout.isTTY !== true || process.stdin.isTTY !== true) {
    return plainTextHandler()
  }

  const [{ mountFleetView }, { createRoot }] = await Promise.all([
    import('@claude-code/repl/screens/agentFleet/mountFleetView.js'),
    import('@anthropic/ink'),
  ])
  const { spawnBgPty } = await import('@claude-code/cli/bg.js')
  const { fleetAttach } = await import('./agentFleetAttach.js')
  const { getCwd } = await import('@claude-code/app-host/bootstrap/cwd.js')

  const root = await createRoot({ exitOnCtrlC: false })

  // Mount FleetView ONCE; callbacks run inline. Callback ordering:
  //   onDispatch → spawnBgPty (fork bg worker, returns immediately)
  //   onAttach   → fleetAttach (pauses Ink, runs child sync, resumes)
  //   onQuit     → root.unmount() (only path that ends the session)
  await mountFleetView({
    currentSessionId: process.env.CLAUDE_SESSION_ID ?? '',
    root,
    onDispatch: prompt => {
      // waitForSocketMs:0 — don't block the dispatch callback. The
      // socket will appear soon; FleetView's onAttach has its own
      // wait-for-socket loop.
      void spawnBgPty({
        flags: [],
        directive: prompt,
        cwd: getCwd(),
        waitForSocketMs: 0,
      }).catch(err =>
        process.stderr.write(`spawn failed: ${(err as Error).message}\n`),
      )
    },
    onAttach: short => {
      // fleetAttach pauses Ink, runs the child synchronously with
      // stdio:inherit, then resumes Ink. FleetView stays mounted —
      // user lands back in it instantly when the child exits.
      void fleetAttach(short).catch(err =>
        process.stderr.write(`attach failed: ${(err as Error).message}\n`),
      )
    },
  })
}
