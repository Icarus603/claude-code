
import type { OutputDep } from '@claude-code/agent'
import type { ToolUseContext } from '../Tool.js'

export class OutputDepImpl implements OutputDep {
  private emitFn?: (event: unknown) => void

  constructor(toolUseContext?: ToolUseContext, emitFn?: (event: unknown) => void) {
    this.emitFn = emitFn
  }

  emit(event: unknown): void {
    this.emitFn?.(event)
  }
}
