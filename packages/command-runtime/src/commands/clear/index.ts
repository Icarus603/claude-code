/**
 * Clear command - minimal metadata only.
 * Implementation is lazy-loaded from clear.ts to reduce startup time.
 * Utility functions:
 * - clearSessionCaches: import from 'src/commands/clear/clear/caches.js'
 * - clearConversation: import from 'src/commands/clear/clear/conversation.js'
 */
import type { Command } from '../../runtime.js'

const clear = {
  type: 'local',
  name: 'clear',
  description: 'Clear conversation history and free up context',
  aliases: ['reset', 'new'],
  supportsNonInteractive: false, // Should just create a new session
  load: () => import('./clear.js'),
} satisfies Command

export default clear
