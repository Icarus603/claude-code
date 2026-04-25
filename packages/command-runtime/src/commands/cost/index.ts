/**
 * Cost command - minimal metadata only.
 * Implementation is lazy-loaded from cost.ts to reduce startup time.
 */
import type { Command } from '@claude-code/command-runtime/runtime'
import { isClaudeAISubscriber } from '@claude-code/provider/authAlias.js'
import { readEnv } from '@claude-code/config/env/utils'

const cost = {
  type: 'local',
  name: 'cost',
  description: 'Show the total cost and duration of the current session',
  get isHidden() {
    // Keep visible for Ants even if they're subscribers (they see cost breakdowns)
    if (readEnv('USER_TYPE') === 'ant') {
      return false
    }
    return isClaudeAISubscriber()
  },
  supportsNonInteractive: true,
  load: () => import('@claude-code/command-runtime/commands/cost/cost.js'),
} satisfies Command

export default cost
