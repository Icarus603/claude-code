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

  // Use the global MACRO.VERSION (set at build time from the git tag).
  // Falls back to a "dev" label when MACRO is absent (REPL evaluator).
  const versionLabel = `v${typeof MACRO !== 'undefined' ? MACRO.VERSION : 'dev'}`

  const root = await createRoot({ exitOnCtrlC: false })
  await mountFleetView({
    versionLabel,
    currentSessionId: process.env.CLAUDE_SESSION_ID ?? '',
    root,
  })
}

declare const MACRO: { VERSION: string } | undefined
