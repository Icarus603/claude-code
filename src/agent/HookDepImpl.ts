
import type { HookDep, StopHookContext, StopHookResult } from '@claude-code/agent'
import type { CoreMessage } from '@claude-code/agent'
import type { ToolUseContext, Message } from '../Tool.js'
import { handleStopHooks } from '@claude-code/agent/hooks'

export class HookDepImpl implements HookDep {
  private toolUseContext: ToolUseContext

  constructor(toolUseContext: ToolUseContext) {
    this.toolUseContext = toolUseContext
  }

  async onTurnStart(_state: any): Promise<void> {
  }

  async onTurnEnd(_state: any): Promise<void> {
  }

  async onStop(messages: CoreMessage[], context: StopHookContext): Promise<StopHookResult> {
    try {
      const result = await handleStopHooks(
        messages as unknown as Message[],
        this.toolUseContext,
      )

      return {
        blockingErrors: result?.blockingErrors ?? [],
        preventContinuation: result?.preventContinuation ?? false,
      }
    } catch {
      return { blockingErrors: [], preventContinuation: false }
    }
  }
}
