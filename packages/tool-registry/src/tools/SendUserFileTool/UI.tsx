import figures from 'figures'
import React from 'react'
import { Box, Text } from '@anthropic/ink'
import type { ProgressMessage } from '@claude-code/agent/messageShapes'
import { BLACK_CIRCLE } from '@claude-code/output/constants/figures.js'
import { formatFileSize } from '@claude-code/output/formatters'
import { getDisplayPath } from '@claude-code/storage/file.js'
import type { Output } from './SendUserFileTool.js'

export function renderToolUseMessage(): React.ReactNode {
  return ''
}

export function renderToolResultMessage(
  output: Output,
  _progressMessages: ProgressMessage[],
): React.ReactNode {
  return (
    <Box flexDirection="row" marginTop={1}>
      <Box minWidth={2}>
        <Text color="text">{BLACK_CIRCLE}</Text>
      </Box>
      <Box flexDirection="column">
        {output.caption ? <Text>{output.caption}</Text> : null}
        <AttachmentList attachments={output.attachments} />
      </Box>
    </Box>
  )
}

type AttachmentListProps = {
  attachments: Output['attachments']
}

function AttachmentList({ attachments }: AttachmentListProps): React.ReactNode {
  if (!attachments || attachments.length === 0) {
    return null
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      {attachments.map(att => (
        <Box key={att.file_uuid ?? att.path} flexDirection="row">
          <Text dimColor>
            {figures.pointerSmall} {att.isImage ? '[image]' : '[file]'}{' '}
          </Text>
          <Text>{getDisplayPath(att.path)}</Text>
          <Text dimColor> ({formatFileSize(att.size)})</Text>
        </Box>
      ))}
    </Box>
  )
}
