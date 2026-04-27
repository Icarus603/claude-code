import * as React from 'react'
import type { LocalJSXCommandContext } from '@claude-code/command-runtime/runtime'
import { BackgroundTasksDialog } from '@claude-code/repl/components/tasks/BackgroundTasksDialog.js'
import type { LocalJSXCommandOnDone } from '../../command.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <BackgroundTasksDialog toolUseContext={context} onDone={onDone} />
}
