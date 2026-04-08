
import type { AgentDeps } from '../types/deps.js'
import type { AgentEvent, DoneReason } from '../types/events.js'
import type { AgentState, AgentInput } from '../types/state.js'
import type { CoreMessage, Usage } from '../types/messages.js'
import { AgentLoop } from './AgentLoop.js'

export class AgentCore {
  private loop: AgentLoop
  private _messages: CoreMessage[]
  private _turnCount: number
  private _totalUsage: Usage
  private _model: string
  private _sessionId: string
  private _interrupted: boolean

  constructor(
    private deps: AgentDeps,
    initialState?: Partial<AgentState>,
  ) {
    this._messages = initialState?.messages ? [...initialState.messages] : []
    this._turnCount = initialState?.turnCount ?? 0
    this._totalUsage = initialState?.totalUsage ?? {
      input_tokens: 0,
      output_tokens: 0,
    }
    this._model = initialState?.model ?? deps.provider.getModel()
    this._sessionId = initialState?.sessionId ?? deps.session.getSessionId()
    this._interrupted = false
    this.loop = new AgentLoop(deps)
  }

  /**
   */
  async *run(input: AgentInput): AsyncGenerator<AgentEvent> {
    this._interrupted = false

    if (input.messages && input.messages.length > 0) {
      this._messages = [...input.messages]
    }

    try {
      for await (const event of this.loop.run(input)) {
        this.updateState(event)
        yield event
        if (this._interrupted) {
          yield {
            type: 'done',
            reason: 'interrupted' as DoneReason,
          }
          return
        }
      }
    } catch (error) {
      yield {
        type: 'done',
        reason: 'error' as DoneReason,
        error,
      }
    }
  }

  interrupt(): void {
    this._interrupted = true
  }

  getMessages(): readonly CoreMessage[] {
    return this._messages
  }

  getState(): AgentState {
    return {
      messages: this._messages,
      turnCount: this._turnCount,
      totalUsage: { ...this._totalUsage },
      model: this._model,
      sessionId: this._sessionId,
    }
  }

  setModel(model: string): void {
    this._model = model
  }


  private updateState(event: AgentEvent): void {
    switch (event.type) {
      case 'message':
        this._messages = [...this._messages, event.message]
        if (
          event.message.type === 'assistant' &&
          event.message.usage
        ) {
          this._totalUsage.input_tokens += event.message.usage.input_tokens
          this._totalUsage.output_tokens += event.message.usage.output_tokens
          if (event.message.usage.cache_creation_input_tokens) {
            this._totalUsage.cache_creation_input_tokens =
              (this._totalUsage.cache_creation_input_tokens ?? 0) +
              event.message.usage.cache_creation_input_tokens
          }
          if (event.message.usage.cache_read_input_tokens) {
            this._totalUsage.cache_read_input_tokens =
              (this._totalUsage.cache_read_input_tokens ?? 0) +
              event.message.usage.cache_read_input_tokens
          }
        }
        break
      case 'compaction':
        this._messages = [...event.after]
        break
      case 'done':
        break
    }
  }
}
