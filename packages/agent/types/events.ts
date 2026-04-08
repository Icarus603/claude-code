
import type { CoreMessage, Usage } from './messages.js'
import type { ToolResult, CoreTool, PermissionResult } from './tools.js'

// --- DoneReason ---

export type DoneReason =
  | 'end_turn'
  | 'max_turns'
  | 'interrupted'
  | 'error'
  | 'stop_hook'
  | 'budget'
  | 'idle'
  | 'shutdown'


export interface MessageEvent {
  type: 'message'
  message: CoreMessage
}

export interface StreamEvent {
  type: 'stream'
  event: { type: string; [key: string]: unknown }
}

export interface ToolStartEvent {
  type: 'tool_start'
  toolUseId: string
  toolName: string
  input: unknown
}

export interface ToolProgressEvent {
  type: 'tool_progress'
  toolUseId: string
  progress: unknown
}

export interface ToolResultEvent {
  type: 'tool_result'
  toolUseId: string
  result: ToolResult
}

export interface PermissionRequestEvent {
  type: 'permission_request'
  tool: CoreTool
  input: unknown
  resolve: (result: PermissionResult) => void
}

export interface CompactionEvent {
  type: 'compaction'
  before: CoreMessage[]
  after: CoreMessage[]
}

export interface RequestStartEvent {
  type: 'request_start'
  params: unknown
}

export interface DoneEvent {
  type: 'done'
  reason: DoneReason
  usage?: Usage
  error?: unknown
}


export interface SwarmMessageEvent {
  type: 'swarm_message'
  from: string
  fromName?: string
  text: string
  summary?: string
}

export interface SwarmIdleEvent {
  type: 'swarm_idle'
  summary: string
}

export interface SwarmShutdownEvent {
  type: 'swarm_shutdown'
  reason: string
}

export type AgentEvent =
  | MessageEvent
  | StreamEvent
  | ToolStartEvent
  | ToolProgressEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | CompactionEvent
  | RequestStartEvent
  | DoneEvent
  | SwarmMessageEvent
  | SwarmIdleEvent
  | SwarmShutdownEvent
