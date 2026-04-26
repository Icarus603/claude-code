import { useCallback, useState } from 'react'

export type FrozenTranscriptState = {
  messagesLength: number
  streamingToolUsesLength: number
} | null

/**
 * Manages frozen-state capture/release for transcript-mode entry/exit.
 *
 * V7 §3.3 — extracted from REPLView.tsx (iter 7). Two callbacks tightly
 * coupled by a single state cell; combining them as a hook reduces hook
 * count in the host and exposes a clean enter/exit contract.
 */
export function useTranscriptFreeze(
  messagesLength: number,
  streamingToolUsesLength: number,
): {
  frozenTranscriptState: FrozenTranscriptState
  handleEnterTranscript: () => void
  handleExitTranscript: () => void
} {
  const [frozenTranscriptState, setFrozenTranscriptState] =
    useState<FrozenTranscriptState>(null)

  const handleEnterTranscript = useCallback(() => {
    setFrozenTranscriptState({
      messagesLength,
      streamingToolUsesLength,
    })
  }, [messagesLength, streamingToolUsesLength])

  const handleExitTranscript = useCallback(() => {
    setFrozenTranscriptState(null)
  }, [])

  return { frozenTranscriptState, handleEnterTranscript, handleExitTranscript }
}
