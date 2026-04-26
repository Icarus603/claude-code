import { useCallback, useRef } from 'react'
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
 * Two prompt-fired commands the host must wire into UI:
 *   - `/issue` or `/feedback` from the survey "thanks" screen
 *   - `/rate-limit-options` from the rate-limit notification
 *
 * V7 §3.3 — extracted from REPLView.tsx. handleOpenRateLimitOptions
 * intentionally goes through an internal ref because it gets prop-drilled
 * to every MessageRow; pinning the unstable onSubmit closure on each fiber
 * leaks ~1.8KB × N MessageRows over a long session. The ref keeps the
 * callback identity stable so old REPL render scopes can be GC'd.
 */
export function useSurveyAndRateLimitHandlers(onSubmit: SubmitFn): {
  handleSurveyRequestFeedback: () => void
  handleOpenRateLimitOptions: () => void
} {
  const handleSurveyRequestFeedback = useCallback(() => {
    const command = process.env.USER_TYPE === 'ant' ? '/issue' : '/feedback'
    onSubmit(command, NOOP_SUBMIT_HELPERS).catch(err => {
      logForDebugging(`Survey feedback request failed: ${errorMessage(err)}`)
    })
  }, [onSubmit])

  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  const handleOpenRateLimitOptions = useCallback(() => {
    void onSubmitRef.current('/rate-limit-options', NOOP_SUBMIT_HELPERS)
  }, [])

  return { handleSurveyRequestFeedback, handleOpenRateLimitOptions }
}
