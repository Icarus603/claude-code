import type { LocalCommandCall } from '@claude-code/agent/command.js'
import { clearConversation } from '@claude-code/command-runtime/commands/clear/conversation.js'

export const call: LocalCommandCall = async (_, context) => {
  await clearConversation(context)
  return { type: 'text', value: '' }
}
