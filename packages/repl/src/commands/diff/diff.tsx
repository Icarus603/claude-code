import * as React from 'react'
import type { LocalJSXCommandCall } from '@claude-code/agent/command.js'

export const call: LocalJSXCommandCall = async (onDone, context) => {
  const { DiffDialog } = await import('@claude-code/repl/components/diff/DiffDialog.js')
  return <DiffDialog messages={context.messages} onDone={onDone} />
}
