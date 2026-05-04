import { useCallback, useRef } from 'react'

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
 * `/rate-limit-options` from the rate-limit notification.
 *
 * The unstable onSubmit closure goes through an internal ref because
 * handleOpenRateLimitOptions gets prop-drilled to every MessageRow; pinning
 * the closure on each fiber leaks ~1.8KB × N MessageRows over a long session.
 * The ref keeps the callback identity stable so old REPL render scopes can
 * be GC'd.
 */
export function useRateLimitHandlers(onSubmit: SubmitFn): {
  handleOpenRateLimitOptions: () => void
} {
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  const handleOpenRateLimitOptions = useCallback(() => {
    void onSubmitRef.current('/rate-limit-options', NOOP_SUBMIT_HELPERS)
  }, [])

  return { handleOpenRateLimitOptions }
}
