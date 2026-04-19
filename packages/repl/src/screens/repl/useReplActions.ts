import { useEffect } from 'react'
import { useIdeLogging } from '@claude-code/ide/hooks/useIdeLogging.js'
import type { IDESelection } from '@claude-code/ide/hooks/useIdeSelection.js'
import { useIdeSelection } from '@claude-code/ide/hooks/useIdeSelection.js'
import { useManagePlugins } from '@claude-code/repl/hooks/useManagePlugins.js'
import { usePromptsFromClaudeInChrome } from '@claude-code/repl/hooks/usePromptsFromClaudeInChrome.js'
import { useSwarmInitialization } from '@claude-code/repl/hooks/useSwarmInitialization.js'
import type { AppState } from 'src/state/AppState.js'
import type { MCPServerConnection } from '@claude-code/mcp-runtime/types.js'
import { performStartupChecks } from 'src/utils/plugins/performStartupChecks.js'
import type { Message } from 'src/types/message.js'
import type { PermissionMode } from 'src/types/permissions.js'

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
