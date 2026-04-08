
import type { z } from 'zod/v4'
import type { CoreContentBlock } from './messages.js'


export type ToolInputJSONSchema = {
  type: 'object'
  properties?: { [key: string]: unknown }
  [key: string]: unknown
}

export interface CoreTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: ToolInputJSONSchema
  readonly userFacingName?: string
  readonly isLocal?: boolean
  readonly isMcp?: boolean
}


export type ToolResult = {
  output: string | CoreContentBlock[]
  error?: boolean
  metadata?: {
    durationMs?: number
    [key: string]: unknown
  }
}


export interface ToolExecContext {
  abortSignal: AbortSignal
  toolUseId: string
  [key: string]: unknown
}


export type PermissionResult =
  | { allowed: true }
  | { allowed: false; reason: string }

export interface PermissionContext {
  mode: string
  input: unknown
  [key: string]: unknown
}
