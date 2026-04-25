import * as React from 'react'
import type { LocalJSXCommandContext } from '@claude-code/command-runtime/runtime'
import { Settings } from '@claude-code/repl/components/Settings/Settings.js'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <Settings onClose={onDone} context={context} defaultTab="Status" />
}
