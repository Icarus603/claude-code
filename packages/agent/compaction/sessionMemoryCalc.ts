/**
 *
 */

import type { SessionMemoryCompactConfig } from '../types/compaction.js'


/**
 */
export type SMMessage = {
  type: string
  message?: {
    content?: unknown
    id?: string
    [key: string]: unknown
  }
  uuid?: string
  [key: string]: unknown
}

/**
 */
export interface SessionMemoryCalcDeps {
  estimateMessageTokens: (messages: SMMessage[]) => number
  isCompactBoundaryMessage: (message: SMMessage) => boolean
}


export const DEFAULT_SM_COMPACT_CONFIG: SessionMemoryCompactConfig = {
  minTokens: 10_000,
  minTextBlockMessages: 5,
  maxTokens: 40_000,
}


/**
 */
export function hasTextBlocks(message: SMMessage): boolean {
  if (message.type === 'assistant') {
    const content = message.message?.content
    return Array.isArray(content) && content.some(block => block.type === 'text')
  }
  if (message.type === 'user') {
    const content = message.message?.content
    if (typeof content === 'string') {
      return content.length > 0
    }
    if (Array.isArray(content)) {
      return content.some(block => block.type === 'text')
    }
  }
  return false
}

/**
 */
function getToolResultIds(message: SMMessage): string[] {
  if (message.type !== 'user') {
    return []
  }
  const content = message.message?.content
  if (!Array.isArray(content)) {
    return []
  }
  const ids: string[] = []
  for (const block of content) {
    if (block.type === 'tool_result') {
      ids.push(block.tool_use_id)
    }
  }
  return ids
}

/**
 */
function hasToolUseWithIds(message: SMMessage, toolUseIds: Set<string>): boolean {
  if (message.type !== 'assistant') {
    return false
  }
  const content = message.message?.content
  if (!Array.isArray(content)) {
    return false
  }
  return content.some(
    block => block.type === 'tool_use' && toolUseIds.has(block.id),
  )
}

/**
 *
 *
 *
 */
export function adjustIndexToPreserveAPIInvariants(
  messages: SMMessage[],
  startIndex: number,
): number {
  if (startIndex <= 0 || startIndex >= messages.length) {
    return startIndex
  }

  let adjustedIndex = startIndex

  // Step 1: Handle tool_use/tool_result pairs
  // Collect tool_result IDs from ALL messages in the kept range
  const allToolResultIds: string[] = []
  for (let i = startIndex; i < messages.length; i++) {
    allToolResultIds.push(...getToolResultIds(messages[i]!))
  }

  if (allToolResultIds.length > 0) {
    // Collect tool_use IDs already in the kept range
    const toolUseIdsInKeptRange = new Set<string>()
    for (let i = adjustedIndex; i < messages.length; i++) {
      const msg = messages[i]!
      if (msg.type === 'assistant' && Array.isArray(msg.message!.content)) {
        for (const block of msg.message!.content as Array<Record<string, unknown>>) {
          if (block.type === 'tool_use') {
            toolUseIdsInKeptRange.add(block.id as string)
          }
        }
      }
    }

    // Only look for tool_uses that are NOT already in the kept range
    const neededToolUseIds = new Set(
      allToolResultIds.filter(id => !toolUseIdsInKeptRange.has(id)),
    )

    // Find the assistant message(s) with matching tool_use blocks
    for (let i = adjustedIndex - 1; i >= 0 && neededToolUseIds.size > 0; i--) {
      const message = messages[i]!
      if (hasToolUseWithIds(message, neededToolUseIds)) {
        adjustedIndex = i
        // Remove found tool_use_ids from the set
        if (
          message.type === 'assistant' &&
          Array.isArray(message.message!.content)
        ) {
          for (const block of message.message!.content as Array<Record<string, unknown>>) {
            if (block.type === 'tool_use' && neededToolUseIds.has(block.id as string)) {
              neededToolUseIds.delete(block.id as string)
            }
          }
        }
      }
    }
  }

  // Step 2: Handle thinking blocks that share message.id with kept assistant messages
  // Collect all message.ids from assistant messages in the kept range
  const messageIdsInKeptRange = new Set<string>()
  for (let i = adjustedIndex; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.type === 'assistant' && msg.message?.id) {
      messageIdsInKeptRange.add(msg.message.id)
    }
  }

  // Look backwards for assistant messages with the same message.id that are not in the kept range
  // These may contain thinking blocks that need to be merged by normalizeMessagesForAPI
  for (let i = adjustedIndex - 1; i >= 0; i--) {
    const message = messages[i]!
    if (
      message.type === 'assistant' &&
      message.message?.id &&
      messageIdsInKeptRange.has(message.message.id)
    ) {
      // This message has the same message.id as one in the kept range
      // Include it so thinking blocks can be properly merged
      adjustedIndex = i
    }
  }

  return adjustedIndex
}

/**
 */
export function calculateMessagesToKeepIndex(
  messages: SMMessage[],
  lastSummarizedIndex: number,
  config: SessionMemoryCompactConfig,
  deps: SessionMemoryCalcDeps,
): number {
  if (messages.length === 0) {
    return 0
  }

  // Start from the message after lastSummarizedIndex
  // If lastSummarizedIndex is -1 (not found) or messages.length (no summarized id),
  // we start with no messages kept
  let startIndex =
    lastSummarizedIndex >= 0 ? lastSummarizedIndex + 1 : messages.length

  // Calculate current tokens and text-block message count from startIndex to end
  let totalTokens = 0
  let textBlockMessageCount = 0
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i]!
    totalTokens += deps.estimateMessageTokens([msg])
    if (hasTextBlocks(msg)) {
      textBlockMessageCount++
    }
  }

  // Check if we already hit the max cap
  if (totalTokens >= config.maxTokens) {
    return adjustIndexToPreserveAPIInvariants(messages, startIndex)
  }

  // Check if we already meet both minimums
  if (
    totalTokens >= config.minTokens &&
    textBlockMessageCount >= config.minTextBlockMessages
  ) {
    return adjustIndexToPreserveAPIInvariants(messages, startIndex)
  }

  // Expand backwards until we meet both minimums or hit max cap.
  // Floor at the last boundary: the preserved-segment chain has a disk
  // discontinuity there (att[0]→summary shortcut from dedup-skip), which
  // would let the loader's tail→head walk bypass inner preserved messages
  // and then prune them. Reactive compact already slices at the boundary
  // via getMessagesAfterCompactBoundary; this is the same invariant.
  const idx = messages.findLastIndex(m => deps.isCompactBoundaryMessage(m))
  const floor = idx === -1 ? 0 : idx + 1
  for (let i = startIndex - 1; i >= floor; i--) {
    const msg = messages[i]!
    const msgTokens = deps.estimateMessageTokens([msg])
    totalTokens += msgTokens
    if (hasTextBlocks(msg)) {
      textBlockMessageCount++
    }
    startIndex = i

    // Stop if we hit the max cap
    if (totalTokens >= config.maxTokens) {
      break
    }

    // Stop if we meet both minimums
    if (
      totalTokens >= config.minTokens &&
      textBlockMessageCount >= config.minTextBlockMessages
    ) {
      break
    }
  }

  // Adjust for tool pairs
  return adjustIndexToPreserveAPIInvariants(messages, startIndex)
}
