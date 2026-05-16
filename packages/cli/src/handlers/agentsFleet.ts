/**
 * `ccb agents` CLI handler — dispatches the FleetView TUI when the
 * terminal is interactive + the feature flag is on, falls through to
 * the plain text list otherwise.
 *
 * Source: ant 5297.js (the agents CLI subcommand handler that
 * eventually calls mountFleetView at 5297.js:365).
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

  // Lazy-import the TUI so non-TTY runs don't pay the React/Ink boot cost.
  const [{ mountFleetView }, { createRoot }] = await Promise.all([
    import('@claude-code/repl/screens/agentFleet/mountFleetView.js'),
    import('@anthropic/ink'),
  ])

  const root = await createRoot({ exitOnCtrlC: false })

  // Buffered post-exit messages — printed AFTER unmount so they don't
  // corrupt the TUI. e.g. attach hint shown after user picks a job.
  const postExitLines: string[] = []

  const { spawnBgJob } = await import('@claude-code/cli/bg.js')
  const { getCwd } = await import('@claude-code/app-host/bootstrap/cwd.js')

  await mountFleetView({
    currentSessionId: process.env.CLAUDE_SESSION_ID ?? '',
    root,
    onDispatch: prompt => {
      // Capture into the post-exit log; spawnBgJob writes its own hint
      // banner to stdout (the cyan short + "ccb ps" tips), so defer the
      // actual spawn until after the TUI unmounts.
      postExitLines.push(`__SPAWN__::${prompt}`)
      root.unmount()
    },
    onAttach: short => {
      postExitLines.push(
        `\nTo resume this session: ${'\x1b[36m'}ccb resume ${short}${'\x1b[0m'}\n`,
      )
      root.unmount()
    },
  })

  // Replay post-exit log. SPAWN lines actually call spawnBgJob now that
  // the TUI is unmounted and stdout is free.
  for (const line of postExitLines) {
    if (line.startsWith('__SPAWN__::')) {
      const directive = line.slice('__SPAWN__::'.length)
      try {
        await spawnBgJob({ flags: [], directive, cwd: getCwd() })
      } catch (err) {
        process.stderr.write(`spawn failed: ${(err as Error).message}\n`)
      }
    } else {
      process.stdout.write(line)
    }
  }
}

