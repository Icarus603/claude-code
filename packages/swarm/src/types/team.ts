
import type { BackendType } from './backends.js'


export interface TeammateIdentity {
  agentId: string
  agentName: string
  parentSessionId: string
  teamName: string
  color?: string
  planModeRequired?: boolean
}


export interface TeammateMessage {
  from: string
  text: string
  timestamp: string
  read: boolean
  color?: string
  summary?: string
}


export interface IdleNotification {
  type: 'idle'
  agentName: string
  idleReason: 'available' | 'interrupted' | 'failed'
  summary?: string
  completedTaskId?: string
  completedStatus?: 'resolved' | 'blocked' | 'failed'
  failureReason?: string
}


export interface ShutdownRequest {
  type: 'shutdown_request'
  from: string
  reason?: string
}


export interface PermissionRequest {
  id: string
  toolName: string
  toolUseId: string
  input: unknown
  description: string
  permissionSuggestions?: unknown
  workerId: string
  workerName: string
  workerColor?: string
  teamName: string
  timestamp: string
}


export interface PermissionResponse {
  type: 'permission_response'
  requestId: string
  decision: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  permissionUpdates?: unknown[]
  feedback?: string
  contentBlocks?: unknown[]
}


export interface TeammateSpawnConfig {
  agentName: string
  teamName: string
  prompt: string
  model?: string
  systemPrompt?: string
  systemPromptMode?: 'default' | 'replace' | 'append'
  allowedTools?: string[]
  allowPermissionPrompts?: boolean
  description?: string
  color?: string
}

export interface TeammateSpawnResult {
  success: boolean
  error?: string
  agentId?: string
}


export interface TeamFile {
  name: string
  members: TeamMember[]
  createdAt: string
  permissionMode: string
}

export interface TeamMember {
  agentId: string
  agentName: string
  color?: string
  backend: BackendType
  status: 'running' | 'idle' | 'stopped'
  joinedAt: string
}


export interface SwarmTask {
  id: string
  subject: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed'
  owner?: string
  blockedBy: string[]
  priority?: number
}
