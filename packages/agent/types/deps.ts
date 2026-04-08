
import type { CoreMessage, Usage } from './messages.js'
import type { CoreTool, ToolResult, PermissionResult, PermissionContext, ToolExecContext } from './tools.js'
import type { AgentState } from './state.js'

// --- Provider Dep ---

export interface ProviderStreamParams {
  systemPrompt?: unknown
  messages: CoreMessage[]
  tools: CoreTool[]
  model: string
  maxTokens?: number
  temperature?: number
  abortSignal?: AbortSignal
  [key: string]: unknown
}

export type ProviderEvent =
  | { type: 'content_block_start'; index: number; content_block: { type: string; [key: string]: unknown } }
  | { type: 'content_block_delta'; index: number; delta: { type: string; [key: string]: unknown } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_start'; message: { id: string; model: string; usage: Usage; [key: string]: unknown } }
  | { type: 'message_delta'; delta: { stop_reason?: string; [key: string]: unknown }; usage: { output_tokens: number } }
  | { type: 'message_stop' }
  | { type: string; [key: string]: unknown }

export interface ProviderDep {
  stream(params: ProviderStreamParams): AsyncIterable<ProviderEvent>
  getModel(): string
}

// --- Tool Dep ---

export interface ToolDep {
  find(name: string): CoreTool | undefined
  list(): CoreTool[]
  execute(tool: CoreTool, input: unknown, context: ToolExecContext): Promise<ToolResult>
}

// --- Permission Dep ---

export interface PermissionDep {
  canUseTool(tool: CoreTool, input: unknown, context: PermissionContext): Promise<PermissionResult>
}

// --- Output Dep ---

export interface OutputDep {
  emit(event: unknown): void
}

// --- Hook Dep ---

export interface StopHookContext {
  [key: string]: unknown
}

export interface StopHookResult {
  blockingErrors: string[]
  preventContinuation: boolean
}

export interface HookDep {
  onTurnStart(state: AgentState): Promise<void>
  onTurnEnd(state: AgentState): Promise<void>
  onStop(messages: CoreMessage[], context: StopHookContext): Promise<StopHookResult>
}

// --- Compaction Dep ---

export interface CompactionResult {
  compacted: boolean
  messages: CoreMessage[]
  tokensSaved?: number
}

export interface CompactionDep {
  maybeCompact(messages: CoreMessage[], tokenCount: number): Promise<CompactionResult>
}

// --- Context Dep ---

export interface SystemPrompt {
  content: unknown
  cacheConfig?: unknown
}

export interface ContextDep {
  getSystemPrompt(): SystemPrompt[]
  getUserContext(): Record<string, string>
  getSystemContext(): Record<string, string>
}

// --- Session Dep ---

export interface SessionDep {
  recordTranscript(messages: CoreMessage[]): Promise<void>
  getSessionId(): string
}


export interface TeammateIdentity {
  name: string
  teamId: string
  teammateId: string
  role: 'worker' | 'leader'
}

export interface IncomingMailMessage {
  from: string
  fromName?: string
  text: string
  summary?: string
  index: number
}

export interface OutgoingMailMessage {
  to?: string
  text: string
  summary?: string
}

export interface MailboxDep {
  poll(): Promise<IncomingMailMessage[]>
  markRead(index: number): Promise<void>
  sendTo(peerId: string, message: OutgoingMailMessage): Promise<void>
  broadcast(message: OutgoingMailMessage): Promise<void>
}

export interface ClaimableTask {
  taskId: string
  description: string
  priority?: number
}

export interface TaskClaimingDep {
  listAvailable(): Promise<ClaimableTask[]>
  claim(taskId: string): Promise<boolean>
  update(taskId: string, status: string): Promise<void>
}

export interface SwarmDep {
  identity: TeammateIdentity
  mailbox: MailboxDep
  taskClaiming: TaskClaimingDep
}


export interface AgentDeps {
  provider: ProviderDep
  tools: ToolDep
  permission: PermissionDep
  output: OutputDep
  hooks: HookDep
  compaction: CompactionDep
  context: ContextDep
  session: SessionDep
  swarm?: SwarmDep
}
