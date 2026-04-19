import React from 'react'
import { Doctor } from '@claude-code/repl/screens/Doctor.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

export const call: LocalJSXCommandCall = (onDone, _context, _args) => {
  return Promise.resolve(<Doctor onDone={onDone} />)
}
