import type { LocalCommandResult } from '@claude-code/command-runtime/runtime'
import type { ToolUseContext } from '@claude-code/tool-registry/Tool.js'

export async function call(
  _args: string,
  context: ToolUseContext,
): Promise<LocalCommandResult> {
  if (context.openMessageSelector) {
    context.openMessageSelector()
  }
  // Return a skip message to not append any messages.
  return { type: 'skip' }
}
