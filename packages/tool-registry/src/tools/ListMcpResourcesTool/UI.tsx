import * as React from 'react'
import { MessageResponse } from '@claude-code/repl/components/MessageResponse.js'
import { OutputLine } from '@claude-code/repl/components/shell/OutputLine.js'
import { Text } from '@anthropic/ink'
import type { ToolProgressData } from '@claude-code/tool-registry/Tool.js'
import type { ProgressMessage } from 'src/types/message.js'
import { jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import type { Output } from './ListMcpResourcesTool.js'

export function renderToolUseMessage(
  input: Partial<{ server?: string }>,
): React.ReactNode {
  return input.server
    ? `List MCP resources from server "${input.server}"`
    : `List all MCP resources`
}

export function renderToolResultMessage(
  output: Output,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!output || output.length === 0) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>(No resources found)</Text>
      </MessageResponse>
    )
  }

  // eslint-disable-next-line no-restricted-syntax -- human-facing UI, not tool_result
  const formattedOutput = jsonStringify(output, null, 2)

  return <OutputLine content={formattedOutput} verbose={verbose} />
}
