import * as React from 'react'
import { Markdown } from '@claude-code/repl/components/Markdown.js'
import { MessageResponse } from '@claude-code/repl/components/MessageResponse.js'
import { RejectedPlanMessage } from '@claude-code/repl/components/messages/UserToolResultMessage/RejectedPlanMessage.js'
import { BLACK_CIRCLE } from 'src/constants/figures.js'
import { getModeColor } from '@claude-code/permission/PermissionMode'
import { Box, Text } from '@anthropic/ink'
import type { ToolProgressData } from '@claude-code/tool-registry/Tool.js'
import type { ProgressMessage } from '@claude-code/agent/messageShapes'
import { getDisplayPath } from 'src/utils/file.js'
import { getPlan } from 'src/utils/plans.js'
import type { ThemeName } from '@anthropic/ink'
import type { Output } from './ExitPlanModeV2Tool.js'

export function renderToolUseMessage(): React.ReactNode {
  return null
}

export function renderToolResultMessage(
  output: Output,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  { theme: _theme }: { theme: ThemeName },
): React.ReactNode {
  const { plan, filePath } = output
  const isEmpty = !plan || plan.trim() === ''
  const displayPath = filePath ? getDisplayPath(filePath) : ''
  const awaitingLeaderApproval = output.awaitingLeaderApproval

  // Simplified message for empty plans
  if (isEmpty) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Text color={getModeColor('plan')}>{BLACK_CIRCLE}</Text>
          <Text> Exited plan mode</Text>
        </Box>
      </Box>
    )
  }

  // When awaiting leader approval, show a different message
  if (awaitingLeaderApproval) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Text color={getModeColor('plan')}>{BLACK_CIRCLE}</Text>
          <Text> Plan submitted for team lead approval</Text>
        </Box>
        <MessageResponse>
          <Box flexDirection="column">
            {filePath && <Text dimColor>Plan file: {displayPath}</Text>}
            <Text dimColor>Waiting for team lead to review and approve...</Text>
          </Box>
        </MessageResponse>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text color={getModeColor('plan')}>{BLACK_CIRCLE}</Text>
        <Text> User approved Claude&apos;s plan</Text>
      </Box>
      <MessageResponse>
        <Box flexDirection="column">
          {filePath && (
            <Text dimColor>Plan saved to: {displayPath} · /plan to edit</Text>
          )}
          <Markdown>{plan}</Markdown>
        </Box>
      </MessageResponse>
    </Box>
  )
}

export function renderToolUseRejectedMessage(
  { plan }: { plan?: string },
  { theme: _theme }: { theme: ThemeName },
): React.ReactNode {
  const planContent = plan ?? getPlan() ?? 'No plan found'

  return (
    <Box flexDirection="column">
      <RejectedPlanMessage plan={planContent} />
    </Box>
  )
}
