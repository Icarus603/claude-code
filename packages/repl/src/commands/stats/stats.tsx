import * as React from 'react'
import { Stats } from '../../components/Stats.js'
import type { LocalJSXCommandCall } from '@claude-code/agent/command.js'

export const call: LocalJSXCommandCall = async onDone => {
  return <Stats onClose={onDone} />
}
