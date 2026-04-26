import { useCallback, type ReactNode } from 'react'
import { spawnSync } from 'child_process'
import { feature } from 'bun:bundle'
import { isBgSession } from '@claude-code/agent/concurrentSessions.js'
import { getCurrentWorktreeSession } from '@claude-code/swarm'
import { ExitFlow } from '@claude-code/repl/components/ExitFlow.js'
import exit from '@claude-code/repl/commands/exit/index.js'

/**
 * Builds the REPL's exit handler — handles three exit paths:
 *   1. Background-session detach (tmux detach-client, no kill)
 *   2. Worktree exit (renders ExitFlow with showWorktree=true)
 *   3. Normal exit (loads exit module, calls call() which gracefulShutdown's)
 *
 * V7 §3.3 — extracted from REPLView.tsx. The host owns isExiting/exitFlow
 * state; this hook owns the branching policy + ExitFlow JSX.
 */
export function useHandleExit(
  setIsExiting: (next: boolean) => void,
  setExitFlow: (next: ReactNode) => void,
): () => Promise<void> {
  return useCallback(async () => {
    setIsExiting(true)
    // In bg sessions, always detach instead of kill — even when a worktree is
    // active. Without this guard, the worktree branch below short-circuits into
    // ExitFlow (which calls gracefulShutdown) before exit.tsx is ever loaded.
    if (feature('BG_SESSIONS') && isBgSession()) {
      spawnSync('tmux', ['detach-client'], { stdio: 'ignore' })
      setIsExiting(false)
      return
    }
    const showWorktree = getCurrentWorktreeSession() !== null
    if (showWorktree) {
      setExitFlow(
        <ExitFlow
          showWorktree
          onDone={() => {}}
          onCancel={() => {
            setExitFlow(null)
            setIsExiting(false)
          }}
        />,
      )
      return
    }
    const exitMod = await exit.load()
    const exitFlowResult = await exitMod.call(() => {})
    setExitFlow(exitFlowResult)
    // If call() returned without killing the process (bg session detach),
    // clear isExiting so the UI is usable on reattach. No-op on the normal
    // path — gracefulShutdown's process.exit() means we never get here.
    if (exitFlowResult === null) {
      setIsExiting(false)
    }
  }, [setIsExiting, setExitFlow])
}
