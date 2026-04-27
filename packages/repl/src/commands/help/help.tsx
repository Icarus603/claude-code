import * as React from 'react'
import { HelpV2 } from '../../components/HelpV2/HelpV2.js'
import type { LocalJSXCommandCall } from '@claude-code/agent/command.js'

export const call: LocalJSXCommandCall = async (
  onDone,
  { options: { commands } },
) => {
  return <HelpV2 commands={commands} onClose={onDone} />
}
