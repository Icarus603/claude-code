import { useCallback } from 'react'
import type { PastedContent } from '@claude-code/config'
import { popAllEditable } from '@claude-code/agent/messageQueueManager.js'

/**
 * Restores the prompt + pasted images from queued commands on cancel.
 *
 * V7 §3.3 — extracted from REPLView.tsx. Pure transform: pop the
 * editable queue, push the popped text + image attachments back into
 * the host's input/paste state.
 */
export function useQueuedCommandOnCancel(
  inputValue: string,
  setInputValue: (next: string) => void,
  setInputMode: (mode: 'prompt') => void,
  setPastedContents: (
    updater: (prev: Record<number, PastedContent>) => Record<number, PastedContent>,
  ) => void,
): () => void {
  return useCallback(() => {
    const result = popAllEditable(inputValue, 0)
    if (!result) return
    setInputValue(result.text)
    setInputMode('prompt')
    if (result.images.length > 0) {
      setPastedContents(prev => {
        const next = { ...prev }
        for (const image of result.images) next[image.id] = image
        return next
      })
    }
  }, [setInputValue, setInputMode, inputValue, setPastedContents])
}
