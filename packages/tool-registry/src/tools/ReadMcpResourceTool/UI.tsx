import * as React from 'react'
import type { z } from 'zod/v4'
import { MessageResponse } from '@claude-code/repl/components/MessageResponse.js'
import { OutputLine } from '@claude-code/repl/components/shell/OutputLine.js'
import { Box, Text } from '@anthropic/ink'
import type { ToolProgressData } from '@claude-code/tool-registry/Tool.js'
import type { ProgressMessage } from 'src/types/message.js'
import { jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import type { inputSchema, Output } from './ReadMcpResourceTool.js'

export function renderToolUseMessage(
  input: Partial<z.infer<ReturnType<typeof inputSchema>>>,
): React.ReactNode {
  if (!input.uri || !input.server) {
    return null
  }
  return `Read resource "${input.uri}" from server "${input.server}"`
}

export function userFacingName(): string {
  return 'readMcpResource'
}

export function renderToolResultMessage(
  output: Output,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!output || !output.contents || output.contents.length === 0) {
    return (
      <Box justifyContent="space-between" overflowX="hidden" width="100%">
        <MessageResponse height={1}>
          <Text dimColor>(No content)</Text>
        </MessageResponse>
      </Box>
    )
  }

  // Format as JSON for better readability
  // eslint-disable-next-line no-restricted-syntax -- human-facing UI, not tool_result
  const formattedOutput = jsonStringify(output, null, 2)

  return <OutputLine content={formattedOutput} verbose={verbose} />
}
