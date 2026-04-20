import * as React from 'react'
import { Box, Text } from '@anthropic/ink'
import type { ToolProgressData } from '@claude-code/tool-registry/Tool.js'
import type { ProgressMessage } from '@claude-code/agent/messageShapes'
import type { ThemeName } from '@anthropic/ink'
import type { Output } from './EnterWorktreeTool.js'

export function renderToolUseMessage(): React.ReactNode {
  return 'Creating worktree…'
}

export function renderToolResultMessage(
  output: Output,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  _options: { theme: ThemeName },
): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text>
        Switched to worktree on branch <Text bold>{output.worktreeBranch}</Text>
      </Text>
      <Text dimColor>{output.worktreePath}</Text>
    </Box>
  )
}
