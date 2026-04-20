import { useContext } from 'react'
import {
  ModalContext,
  useIsInsideModal,
  useModalScrollRef,
} from '@anthropic/ink'

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
