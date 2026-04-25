import { useEffect } from 'react'

type EventEmitterLike = {
  on(event: string, handler: () => void): void
  off(event: string, handler: () => void): void
}

/**
 * Wires SIGTSTP / SIGCONT signals to user-facing print + remount.
 * On suspend: prints `fg` instructions to stdout.
 * On resume: triggers a remount by incrementing the remount key.
 *
 * V7 §3.3 — extracted from REPLView.tsx (iter 24) so the host doesn't
 * carry process-signal wiring inline.
 */
export function useSuspendResumeHandlers(
  internal_eventEmitter: EventEmitterLike | undefined,
  setRemountKey: (updater: (prev: number) => number) => void,
): void {
  useEffect(() => {
    const handleSuspend = () => {
      process.stdout.write(
        `\nClaude Code has been suspended. Run \`fg\` to bring Claude Code back.\nNote: ctrl + z now suspends Claude Code, ctrl + _ undoes input.\n`,
      )
    }

    const handleResume = () => {
      // Force complete component tree replacement instead of terminal clear
      // Ink now handles line count reset internally on SIGCONT
      setRemountKey(prev => prev + 1)
    }

    internal_eventEmitter?.on('suspend', handleSuspend)
    internal_eventEmitter?.on('resume', handleResume)
    return () => {
      internal_eventEmitter?.off('suspend', handleSuspend)
      internal_eventEmitter?.off('resume', handleResume)
    }
  }, [internal_eventEmitter, setRemountKey])
}
