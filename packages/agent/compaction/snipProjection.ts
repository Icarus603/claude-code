/**
 */
import type { CoreMessage } from '../types/messages.js'

const SNIP_BOUNDARY_SUBTYPE = 'snip_boundary'

/**
 */
export function isSnipBoundaryMessage(message: CoreMessage): boolean {
  if (message.type !== 'system') return false
  return (message as { subtype?: string }).subtype === SNIP_BOUNDARY_SUBTYPE
}

/**
 */
export function projectSnippedView(messages: CoreMessage[]): CoreMessage[] {
  const boundaryIndex = messages.findIndex(m => isSnipBoundaryMessage(m))
  if (boundaryIndex === -1) return messages
  return messages.slice(boundaryIndex)
}
