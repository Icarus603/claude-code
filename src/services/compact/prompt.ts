import { feature } from 'bun:bundle'
import type { PartialCompactDirection } from '../../types/message.js'

export {
  getCompactPrompt,
  formatCompactSummary,
} from '../../../packages/agent/compaction/prompt.js'

import {
  getPartialCompactPrompt as getPartialCompactPromptImpl,
  getCompactUserSummaryMessage as getCompactUserSummaryMessageImpl,
} from '../../../packages/agent/compaction/prompt.js'

export function getPartialCompactPrompt(
  customInstructions?: string,
  direction: PartialCompactDirection = 'from',
): string {
  const normalizedDirection = direction === 'up_to' ? 'up_to' : 'from'
  return getPartialCompactPromptImpl(customInstructions, normalizedDirection)
}

export function getCompactUserSummaryMessage(
  summary: string,
  suppressFollowUpQuestions?: boolean,
  transcriptPath?: string,
  recentMessagesPreserved?: boolean,
): string {
  const isProactiveActive =
    feature('PROACTIVE') ? true : feature('KAIROS') ? true : false

  return getCompactUserSummaryMessageImpl(
    summary,
    suppressFollowUpQuestions,
    transcriptPath,
    recentMessagesPreserved,
    isProactiveActive,
  )
}
