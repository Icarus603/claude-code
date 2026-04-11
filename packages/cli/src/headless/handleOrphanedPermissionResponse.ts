/**
 * Handles unexpected permission responses by looking up the unresolved
 * tool call in the transcript and enqueuing it for execution.
 *
 * Pure function with all I/O injected via `deps`. Types are structural
 * so the package doesn't need to import SDKControlResponse /
 * PermissionResult from root.
 *
 * Returns true if a permission was enqueued, false otherwise.
 *
 * Moved from src/cli/print.ts per V7 §10.2. The `setAppState` parameter
 * present in the original version was dead code and was dropped here.
 */

export type OrphanedPermissionMessage = {
  response?: {
    subtype?: string
    response?: { toolUseID?: unknown } & Record<string, unknown>
    request_id?: string
  }
}

export type OrphanedPermissionResult = {
  toolUseID?: string
} & Record<string, unknown>

export type OrphanedAssistantMessage = {
  message: { id: string }
} & Record<string, unknown>

export type OrphanedPermissionDeps = {
  findUnresolvedToolUse: (
    toolUseID: string,
  ) => Promise<OrphanedAssistantMessage | null | undefined>
  enqueue: (entry: {
    mode: 'orphaned-permission'
    value: unknown[]
    orphanedPermission: {
      permissionResult: OrphanedPermissionResult
      assistantMessage: OrphanedAssistantMessage
    }
  }) => void
  logDebug: (message: string) => void
}

export async function handleOrphanedPermissionResponse({
  message,
  handledToolUseIds,
  onEnqueued,
  deps,
}: {
  message: OrphanedPermissionMessage
  handledToolUseIds: Set<string>
  onEnqueued?: () => void
  deps: OrphanedPermissionDeps
}): Promise<boolean> {
  const responseInner = message.response
  if (
    responseInner?.subtype === 'success' &&
    responseInner.response?.toolUseID &&
    typeof responseInner.response.toolUseID === 'string'
  ) {
    const permissionResult = responseInner.response as OrphanedPermissionResult
    const toolUseID = permissionResult.toolUseID
    if (!toolUseID) {
      return false
    }

    deps.logDebug(
      `handleOrphanedPermissionResponse: received orphaned control_response for toolUseID=${toolUseID} request_id=${responseInner.request_id}`,
    )

    // Prevent re-processing the same orphaned tool_use. Without this guard,
    // duplicate control_response deliveries (e.g. from WebSocket reconnect)
    // cause the same tool to be executed multiple times, producing duplicate
    // tool_use IDs in the messages array and a 400 error from the API.
    // Once corrupted, every retry accumulates more duplicates.
    if (handledToolUseIds.has(toolUseID)) {
      deps.logDebug(
        `handleOrphanedPermissionResponse: skipping duplicate orphaned permission for toolUseID=${toolUseID} (already handled)`,
      )
      return false
    }

    const assistantMessage = await deps.findUnresolvedToolUse(toolUseID)
    if (!assistantMessage) {
      deps.logDebug(
        `handleOrphanedPermissionResponse: no unresolved tool_use found for toolUseID=${toolUseID} (already resolved in transcript)`,
      )
      return false
    }

    handledToolUseIds.add(toolUseID)
    deps.logDebug(
      `handleOrphanedPermissionResponse: enqueuing orphaned permission for toolUseID=${toolUseID} messageID=${assistantMessage.message.id}`,
    )
    deps.enqueue({
      mode: 'orphaned-permission' as const,
      value: [],
      orphanedPermission: {
        permissionResult,
        assistantMessage,
      },
    })

    onEnqueued?.()
    return true
  }
  return false
}
