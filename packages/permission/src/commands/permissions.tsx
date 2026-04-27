import * as React from 'react'
import { PermissionRuleList } from '../components/rules/PermissionRuleList.js'
import type { LocalJSXCommandCall } from '@claude-code/agent/command.js'
import { createPermissionRetryMessage } from '@claude-code/agent/messages.js'

export const call: LocalJSXCommandCall = async (onDone, context) => {
  return (
    <PermissionRuleList
      onExit={onDone}
      onRetryDenials={commands => {
        context.setMessages(prev => [
          ...prev,
          createPermissionRetryMessage(commands),
        ])
      }}
    />
  )
}
