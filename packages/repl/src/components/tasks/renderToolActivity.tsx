import React from 'react'
import { Text } from '@anthropic/ink'
import type { Tools } from '@claude-code/tool-registry/Tool.js'
import { findToolByName } from '@claude-code/tool-registry/Tool.js'
import type { ToolActivity } from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import type { ThemeName } from 'src/utils/theme.js'

export function renderToolActivity(
  activity: ToolActivity,
  tools: Tools,
  theme: ThemeName,
): React.ReactNode {
  const tool = findToolByName(tools, activity.toolName)
  if (!tool) {
    return activity.toolName
  }
  try {
    const parsed = tool.inputSchema.safeParse(activity.input)
    const parsedInput = parsed.success ? parsed.data : {}
    const userFacingName = tool.userFacingName(parsedInput)
    if (!userFacingName) {
      return activity.toolName
    }
    const toolArgs = tool.renderToolUseMessage(parsedInput, {
      theme,
      verbose: false,
    })
    if (toolArgs) {
      return (
        <Text>
          {userFacingName}({toolArgs})
        </Text>
      )
    }
    return userFacingName
  } catch {
    return activity.toolName
  }
}
