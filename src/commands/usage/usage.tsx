import * as React from 'react'
import { Settings } from '@claude-code/repl/components/Settings/Settings.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

export const call: LocalJSXCommandCall = async (onDone, context) => {
  return <Settings onClose={onDone} context={context} defaultTab="Usage" />
}
