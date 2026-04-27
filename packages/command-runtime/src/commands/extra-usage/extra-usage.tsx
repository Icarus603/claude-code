import React from 'react'
import type { LocalJSXCommandContext } from '@claude-code/command-runtime/runtime'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import { Login } from '@claude-code/command-runtime/commands/login/login.js'
import { runExtraUsage } from '@claude-code/command-runtime/commands/extra-usage/extra-usage-core.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode | null> {
  const result = await runExtraUsage()

  if (result.type === 'message') {
    onDone(result.value)
    return null
  }

  return (
    <Login
      startingMessage={
        'Starting new login following /extra-usage. Exit with Ctrl-C to use existing account.'
      }
      onDone={success => {
        context.onChangeAPIKey()
        onDone(success ? 'Login successful' : 'Login interrupted')
      }}
    />
  )
}
