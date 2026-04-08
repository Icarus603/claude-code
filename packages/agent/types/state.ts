
import type { CoreMessage, Usage } from './messages.js'


export interface AgentState {
  readonly messages: readonly CoreMessage[]
  readonly turnCount: number
  readonly totalUsage: Usage
  readonly model: string
  readonly sessionId: string
}


export interface AgentInput {
  prompt?: string
  messages: CoreMessage[]
  maxTurns?: number
  abortSignal?: AbortSignal
  tokenBudget?: number | null
  attachments?: Array<{ type: string; [key: string]: unknown }>
}


export interface TurnState {
  pendingToolUses: Array<{
    id: string
    name: string
    input: unknown
  }>
  textBlocks: Array<{ type: 'text'; text: string }>
  currentTextBlockIndex: number
  thinkingBlocks: Array<{ type: 'thinking'; thinking: string }>
  currentThinkingBlockIndex: number
  turnUsage: Usage
  stoppedByHook: boolean
  /** LLM stop_reason */
  stopReason?: string
}
