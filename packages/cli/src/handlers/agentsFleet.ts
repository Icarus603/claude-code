/**
 * `ccb agents` CLI handler — dispatches the FleetView TUI when the
 * terminal is interactive + the feature flag is on, falls through to
 * the plain text list otherwise.
 *
 * Source: ant 5297.js (the agents CLI subcommand handler that
 * eventually calls mountFleetView at 5297.js:365).
 *
 * Lifecycle:
 *   Loop:
 *     mountFleetView → user picks an action
 *     if onQuit → break
 *     if onDispatch(prompt) → spawnBgJob, then re-mount FleetView
 *     if onAttach(short) → attachHandler (PTY or logs), then re-mount
 *   The loop is what lets the user fluidly bounce between FleetView
 *   and an open session via right-arrow / left-arrow.
 */

import { feature } from 'bun:bundle'

import { agentsHandler as plainTextHandler } from './agents.js'

type Action =
  | { kind: 'quit' }
  | { kind: 'dispatch'; prompt: string }
  | { kind: 'attach'; short: string }

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
  const { spawnBgJob, attachHandler } = await import('@claude-code/cli/bg.js')
  const { getCwd } = await import('@claude-code/app-host/bootstrap/cwd.js')

  // Top-level loop: each iteration is one mount/unmount of FleetView.
  // dispatch/attach actions run between iterations.
  while (true) {
    const action = await runOneFleetSession({
      mountFleetView,
      createRoot,
    })

    if (action.kind === 'quit') break

    if (action.kind === 'dispatch') {
      try {
        await spawnBgJob({ flags: [], directive: action.prompt, cwd: getCwd() })
      } catch (err) {
        process.stderr.write(`spawn failed: ${(err as Error).message}\n`)
      }
      // Loop back into FleetView so the user sees the new row.
      continue
    }

    if (action.kind === 'attach') {
      try {
        await attachHandler([action.short])
      } catch (err) {
        process.stderr.write(`attach failed: ${(err as Error).message}\n`)
      }
      // On exit from attach (Ctrl+Q in PTY, Ctrl+C in logs), back to FleetView.
      continue
    }
  }
}

interface RunOneOpts {
  mountFleetView: typeof import('@claude-code/repl/screens/agentFleet/mountFleetView.js').mountFleetView
  createRoot: typeof import('@anthropic/ink').createRoot
}

async function runOneFleetSession({
  mountFleetView,
  createRoot,
}: RunOneOpts): Promise<Action> {
  const root = await createRoot({ exitOnCtrlC: false })

  let resolved: Action | undefined

  await mountFleetView({
    currentSessionId: process.env.CLAUDE_SESSION_ID ?? '',
    root,
    onDispatch: prompt => {
      if (resolved !== undefined) return
      resolved = { kind: 'dispatch', prompt }
      root.unmount()
    },
    onAttach: short => {
      if (resolved !== undefined) return
      resolved = { kind: 'attach', short }
      root.unmount()
    },
  })

  return resolved ?? { kind: 'quit' }
}
