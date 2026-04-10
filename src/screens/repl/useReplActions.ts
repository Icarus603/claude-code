import { useEffect } from 'react'
import { useIdeLogging } from '../../hooks/useIdeLogging.js'
import type { IDESelection } from '../../hooks/useIdeSelection.js'
import { useIdeSelection } from '../../hooks/useIdeSelection.js'
import { useManagePlugins } from '../../hooks/useManagePlugins.js'
import { usePromptsFromClaudeInChrome } from '../../hooks/usePromptsFromClaudeInChrome.js'
import { useSwarmInitialization } from '../../hooks/useSwarmInitialization.js'
import type { AppState } from '../../state/AppState.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import { performStartupChecks } from '../../utils/plugins/performStartupChecks.js'
import type { Message } from '../../types/message.js'
import type { PermissionMode } from '../../types/permissions.js'

type SetAppState = (f: (prevState: AppState) => AppState) => void

type Args = {
  initialMessages: Message[] | undefined
  isRemoteSession: boolean
  mcpClients: MCPServerConnection[]
  setAppState: SetAppState
  setIDESelection: (selection: IDESelection | undefined) => void
  toolPermissionMode: PermissionMode
}

export function useReplActions({
  initialMessages,
  isRemoteSession,
  mcpClients,
  setAppState,
  setIDESelection,
  toolPermissionMode,
}: Args): void {
  useManagePlugins({ enabled: !isRemoteSession })

  useEffect(() => {
    if (isRemoteSession) return
    void performStartupChecks(setAppState)
  }, [isRemoteSession, setAppState])

  usePromptsFromClaudeInChrome(mcpClients, toolPermissionMode)
  useSwarmInitialization(setAppState, initialMessages, {
    enabled: !isRemoteSession,
  })
  useIdeLogging(mcpClients)
  useIdeSelection(mcpClients, selection => setIDESelection(selection))
}
