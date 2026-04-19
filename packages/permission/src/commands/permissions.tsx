import * as React from 'react'
import { PermissionRuleList } from '@claude-code/permission/components/rules/PermissionRuleList.js'
import type { LocalJSXCommandCall } from 'src/types/command.js'
import { createPermissionRetryMessage } from 'src/utils/messages.js'

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
