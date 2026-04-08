
import type { CompactionDep, CompactionResult, CoreMessage } from '@claude-code/agent'
import type { ToolUseContext, Message } from '../Tool.js'
import { autoCompactIfNeeded, isAutoCompactEnabled } from '../services/compact/autoCompact.js'
import { microcompactMessages } from '../services/compact/microCompact.js'
import { buildPostCompactMessages } from '../services/compact/compact.js'

export class CompactionDepImpl implements CompactionDep {
  private toolUseContext: ToolUseContext

  constructor(toolUseContext: ToolUseContext) {
    this.toolUseContext = toolUseContext
  }

  async maybeCompact(messages: CoreMessage[], tokenCount: number): Promise<CompactionResult> {
    const rawMessages = messages as unknown as Message[]

    try {
      const microResult = await microcompactMessages({
        messages: rawMessages,
        toolUseContext: this.toolUseContext,
      })
      if (microResult.messages !== rawMessages && Array.isArray(microResult.messages)) {
        return {
          compacted: true,
          messages: microResult.messages as unknown as CoreMessage[],
          tokensSaved: microResult.tokensFreed,
        }
      }
    } catch {
    }

    if (isAutoCompactEnabled()) {
      try {
        const autoResult = await autoCompactIfNeeded({
          messages: rawMessages,
          toolUseContext: this.toolUseContext,
          tokenUsage: tokenCount,
          model: this.toolUseContext.options.mainLoopModel,
        })
        if (autoResult?.messages && Array.isArray(autoResult.messages)) {
          return {
            compacted: true,
            messages: autoResult.messages as unknown as CoreMessage[],
          }
        }
      } catch {
      }
    }

    return { compacted: false, messages }
  }
}
