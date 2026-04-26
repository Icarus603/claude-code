// Leaf type module: holds PermissionRequestProps + ToolUseConfirm.
// Extracted from PermissionRequest.tsx so per-tool permission components
// (FilesystemPermissionRequest, BashPermissionRequest, ...) can import
// these types without forming a cycle with PermissionRequest.tsx (which
// imports them as concrete components).

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type * as React from 'react'
import type { AnyObject, Tool, ToolUseContext } from '@claude-code/tool-registry/Tool.js'
import type { AssistantMessage } from '@claude-code/agent/messageShapes'
import type { PermissionDecision } from '@claude-code/permission/PermissionResult'
import type { PermissionUpdate } from '@claude-code/permission/PermissionUpdateSchema'
import type { WorkerBadgeProps } from './WorkerBadge.js'
import type { z } from 'zod'

export type PermissionRequestProps<Input extends AnyObject = AnyObject> = {
  toolUseConfirm: ToolUseConfirm<Input>
  toolUseContext: ToolUseContext
  onDone(): void
  onReject(): void
  verbose: boolean
  workerBadge: WorkerBadgeProps | undefined
  /**
   * Register JSX to render in a sticky footer below the scrollable area.
   * Fullscreen mode only. Call with null to clear.
   */
  setStickyFooter?: (jsx: React.ReactNode | null) => void
}

export type ToolUseConfirm<Input extends AnyObject = AnyObject> = {
  assistantMessage: AssistantMessage
  tool: Tool<Input>
  description: string
  input: z.infer<Input>
  toolUseContext: ToolUseContext
  toolUseID: string
  permissionResult: PermissionDecision
  permissionPromptStartTimeMs: number
  classifierCheckInProgress?: boolean
  classifierAutoApproved?: boolean
  classifierMatchedRule?: string
  workerBadge?: WorkerBadgeProps
  onUserInteraction(): void
  onAbort(): void
  onDismissCheckmark?(): void
  onAllow(
    updatedInput: z.infer<Input>,
    permissionUpdates: PermissionUpdate[],
    feedback?: string,
    contentBlocks?: ContentBlockParam[],
  ): void
  onReject(feedback?: string, contentBlocks?: ContentBlockParam[]): void
  recheckPermission(): Promise<void>
}
