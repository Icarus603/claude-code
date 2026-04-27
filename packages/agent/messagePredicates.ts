import type { Message, UserMessage } from './messageShapes.js'

// tool_result messages share type:'user' with human turns; the discriminant is
// the optional toolUseResult field.
export function isHumanTurn(m: Message): m is UserMessage {
  return m.type === 'user' && !m.isMeta && m.toolUseResult === undefined
}
