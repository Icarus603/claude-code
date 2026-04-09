import { useContext } from 'react'
import {
  ModalContext,
  useIsInsideModal,
  useModalScrollRef,
} from '@anthropic/ink'

/**
 * Available content rows/columns when inside a Modal, else falls back to
 * the provided terminal size. Use instead of `useTerminalSize()` when a
 * component caps its visible content height — the modal's inner area is
 * smaller than the terminal.
 */
export function useModalOrTerminalSize(fallback: {
  rows: number
  columns: number
}): { rows: number; columns: number } {
  const modal = useContext(ModalContext)
  return modal
    ? { rows: modal.rows, columns: modal.columns }
    : fallback
}

export { ModalContext, useIsInsideModal, useModalScrollRef }
