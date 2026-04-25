import type { Command } from '@claude-code/command-runtime/runtime'
import { isClaudeAISubscriber } from '@claude-code/provider/authAlias.js'

const rateLimitOptions = {
  type: 'local-jsx',
  name: 'rate-limit-options',
  description: 'Show options when rate limit is reached',
  isEnabled: () => {
    if (!isClaudeAISubscriber()) {
      return false
    }

    return true
  },
  isHidden: true, // Hidden from help - only used internally
  load: () => import('@claude-code/command-runtime/commands/rate-limit-options/rate-limit-options.js'),
} satisfies Command

export default rateLimitOptions
