import { useCallback } from 'react'
import {
  getAutoRunCommand,
  type AutoRunIssueReason,
} from '../../diagnostics/autoRunIssue.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { errorMessage } from '@claude-code/local-observability/errorHelpers.js'

type SubmitFn = (
  command: string,
  helpers: {
    setCursorOffset: () => void
    clearBuffer: () => void
    resetHistory: () => void
  },
) => Promise<unknown>

const NOOP_SUBMIT_HELPERS = {
  setCursorOffset: () => {},
  clearBuffer: () => {},
  resetHistory: () => {},
}

/**
 * Handlers for the AutoRunIssueNotification UI: run the diagnostic command
 * (defaults to /issue) or cancel without firing.
 *
 * V7 §3.3 — extracted from REPLView.tsx. The host owns onSubmit and the
 * autoRunIssueReason state cell; this hook owns the run/cancel policy.
 */
export function useAutoRunIssueHandlers(
  onSubmit: SubmitFn,
  autoRunIssueReason: AutoRunIssueReason | null,
  setAutoRunIssueReason: (next: AutoRunIssueReason | null) => void,
): {
  handleAutoRunIssue: () => void
  handleCancelAutoRunIssue: () => void
} {
  const handleAutoRunIssue = useCallback(() => {
    const command = autoRunIssueReason ? getAutoRunCommand(autoRunIssueReason) : '/issue'
    setAutoRunIssueReason(null)
    onSubmit(command, NOOP_SUBMIT_HELPERS).catch(err => {
      logForDebugging(`Auto-run ${command} failed: ${errorMessage(err)}`)
    })
  }, [onSubmit, autoRunIssueReason, setAutoRunIssueReason])

  const handleCancelAutoRunIssue = useCallback(() => {
    setAutoRunIssueReason(null)
  }, [setAutoRunIssueReason])

  return { handleAutoRunIssue, handleCancelAutoRunIssue }
}
