import { basename } from 'path'
import * as React from 'react'
import { useIdeConnectionStatus } from '@claude-code/ide/hooks/useIdeConnectionStatus.js'
import type { IDESelection } from '@claude-code/ide/hooks/useIdeSelection.js'
import { Text } from '@anthropic/ink'
import type { MCPServerConnection } from '@claude-code/mcp-runtime/types.js'

type IdeStatusIndicatorProps = {
  ideSelection: IDESelection | undefined
  mcpClients?: MCPServerConnection[]
}

export function IdeStatusIndicator({
  ideSelection,
  mcpClients,
}: IdeStatusIndicatorProps): React.ReactNode {
  const { status: ideStatus } = useIdeConnectionStatus(mcpClients)

  // Check if we should show the IDE selection indicator
  const shouldShowIdeSelection =
    ideStatus === 'connected' &&
    (ideSelection?.filePath ||
      (ideSelection?.text && ideSelection.lineCount > 0))

  if (ideStatus === null || !shouldShowIdeSelection || !ideSelection) {
    return null
  }

  if (ideSelection.text && ideSelection.lineCount > 0) {
    return (
      <Text color="ide" key="selection-indicator" wrap="truncate">
        ⧉ {ideSelection.lineCount}{' '}
        {ideSelection.lineCount === 1 ? 'line' : 'lines'} selected
      </Text>
    )
  }

  if (ideSelection.filePath) {
    return (
      <Text color="ide" key="selection-indicator" wrap="truncate">
        ⧉ In {basename(ideSelection.filePath)}
      </Text>
    )
  }
}
