import { useMemo } from 'react'
import { isEnvTruthy } from '@claude-code/config/env/utils'

/**
 * Stable env-derived flags read once at REPL mount.
 *
 * V7 §3.3 — extracted from REPLView.tsx (iter 21). Each flag was an inline
 * useMemo; consolidating into one hook reduces hook-count noise in the host
 * and makes the env contract explicit.
 */
export function useReplEnvFlags(): {
  titleDisabled: boolean
  moreRightEnabled: boolean
  disableVirtualScroll: boolean
} {
  const titleDisabled = useMemo(
    () => isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE),
    [],
  )
  const moreRightEnabled = useMemo(
    () =>
      process.env.USER_TYPE === 'ant' && isEnvTruthy(process.env.CLAUDE_MORERIGHT),
    [],
  )
  const disableVirtualScroll = useMemo(
    () => isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL),
    [],
  )
  return { titleDisabled, moreRightEnabled, disableVirtualScroll }
}
