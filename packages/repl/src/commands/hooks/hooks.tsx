import * as React from 'react'
import { HooksConfigMenu } from '../../components/hooks/HooksConfigMenu.js'
import { logEvent } from '@claude-code/local-observability'
import { getTools } from '@claude-code/tool-registry/runtime'
import type { LocalJSXCommandCall } from '@claude-code/agent/command.js'

export const call: LocalJSXCommandCall = async (onDone, context) => {
  logEvent('tengu_hooks_command', {})
  const appState = context.getAppState()
  const permissionContext = appState.toolPermissionContext
  const toolNames = getTools(permissionContext).map(tool => tool.name)
  return <HooksConfigMenu toolNames={toolNames} onExit={onDone} />
}
