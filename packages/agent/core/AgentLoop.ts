
import type { AgentDeps, ProviderEvent, ProviderStreamParams } from '../types/deps.js'
import type { AgentEvent, DoneReason } from '../types/events.js'
import type { AgentInput, TurnState } from '../types/state.js'
import type {
  CoreMessage,
  CoreAssistantMessage,
  CoreUserMessage,
  CoreContentBlock,
  Usage,
} from '../types/messages.js'
import type { CoreTool, ToolResult } from '../types/tools.js'
import { createBudgetTracker, checkTokenBudget } from '../internal/tokenBudget.js'
import { createSyntheticToolResults, shouldAbort } from '../internal/abort.js'

export class AgentLoop {
  constructor(private deps: AgentDeps) {}

  /**
   *
   * 3. yield MessageEvent / StreamEvent
   * 7. yield ToolResultEvent
   */
  async *run(input: AgentInput): AsyncGenerator<AgentEvent> {
    const maxTurns = input.maxTurns ?? Infinity
    const budget = input.tokenBudget ?? null
    const abortSignal = input.abortSignal
    let messages: CoreMessage[] = [...input.messages]
    let turnCount = 0
    const budgetTracker = createBudgetTracker()

    if (input.prompt) {
      const userMsg = this.createUserMessage(input.prompt, input.attachments)
      messages = [...messages, userMsg]
    }

    while (turnCount < maxTurns) {
      await this.deps.hooks.onTurnStart(
        this.createAgentState(messages, turnCount),
      )

      if (shouldAbort(abortSignal)) {
        await this.deps.hooks.onTurnEnd(
          this.createAgentState(messages, turnCount),
        )
        yield { type: 'done', reason: 'interrupted' as DoneReason }
        return
      }

      if (this.deps.swarm) {
        const inboxMessages = await this.deps.swarm.mailbox.poll()
        if (inboxMessages.length > 0) {
          for (const msg of inboxMessages) {
            yield {
              type: 'swarm_message',
              from: msg.from,
              fromName: msg.fromName,
              text: msg.text,
              summary: msg.summary,
            }
            messages = [...messages, this.createUserMessage(msg.text)]
          }
        }
      }

      const systemPrompt = this.deps.context.getSystemPrompt()
      const userContext = this.deps.context.getUserContext()
      const systemContext = this.deps.context.getSystemContext()

      const tools = this.collectTools()
      const streamParams: ProviderStreamParams = {
        systemPrompt,
        messages,
        tools,
        model: this.deps.provider.getModel(),
        maxTokens: undefined,
        temperature: undefined,
        abortSignal,
        ...userContext,
        ...systemContext,
      }

      yield { type: 'request_start', params: streamParams }

      let assistantMessage: CoreAssistantMessage | null = null
      let streamError: unknown = null
      const turnState: TurnState = {
        pendingToolUses: [],
        textBlocks: [],
        currentTextBlockIndex: -1,
        thinkingBlocks: [],
        currentThinkingBlockIndex: -1,
        turnUsage: { input_tokens: 0, output_tokens: 0 },
        stoppedByHook: false,
      }

      try {
        const stream = this.deps.provider.stream(streamParams)

        for await (const event of stream) {
          const eventType = (event as any).type
          if (eventType === 'assistant') {
            assistantMessage = event as unknown as CoreAssistantMessage
            yield { type: 'message', message: assistantMessage }
          } else if (eventType === 'system') {
            yield { type: 'message', message: event as unknown as CoreMessage }
          } else {
            yield { type: 'stream', event }
            const rawEvent = eventType === 'stream_event'
              ? (event as any).event
              : event
            this.processStreamEvent(rawEvent, turnState)
          }
        }

        if (!assistantMessage) {
          assistantMessage = this.buildAssistantMessage(turnState)
          if (assistantMessage.content.length > 0 || turnState.stopReason) {
            yield { type: 'message', message: assistantMessage }
          }
        }
      } catch (error) {
        streamError = error
      }

      if (streamError !== null) {
        yield { type: 'done', reason: 'error' as DoneReason, error: streamError }
        return
      }

      if (assistantMessage) {
        messages = [...messages, assistantMessage]
      }

      turnCount++
      const rawAsst = assistantMessage as any
      const stopReason: string | null | undefined = rawAsst?.stop_reason ?? rawAsst?.message?.stop_reason ?? turnState.stopReason ?? null
      if (stopReason !== 'tool_use') {
        const budgetDecision = checkTokenBudget(
          budgetTracker,
          undefined,
          budget,
          budgetTracker.lastGlobalTurnTokens,
        )

        if (budgetDecision.action === 'continue') {
          const continueMsg = this.createUserMessage(budgetDecision.nudgeMessage)
          messages = [...messages, continueMsg]
          continue
        }

        // --- Step 3.5: Stop hooks ---
        const hookResult = await this.deps.hooks.onStop(messages, {})
        if (hookResult.preventContinuation) {
          await this.deps.hooks.onTurnEnd(
            this.createAgentState(messages, turnCount),
          )
          yield { type: 'done', reason: 'stop_hook' as DoneReason }
          return
        }

        if (this.deps.swarm) {
          const lastText = turnState.textBlocks.map(b => b.text).join('\n').slice(0, 200)
          await this.deps.hooks.onTurnEnd(
            this.createAgentState(messages, turnCount),
          )
          yield { type: 'swarm_idle', summary: lastText || 'Teammate completed task' }
          yield { type: 'done', reason: 'idle' as DoneReason, usage: this.aggregateUsage(messages) }
          return
        }

        await this.deps.hooks.onTurnEnd(
          this.createAgentState(messages, turnCount),
        )
        yield { type: 'done', reason: 'end_turn' as DoneReason, usage: this.aggregateUsage(messages) }
        return
      }

      const toolUses = this.extractToolUses(assistantMessage)
      if (toolUses.length === 0) {
        await this.deps.hooks.onTurnEnd(
          this.createAgentState(messages, turnCount),
        )
        yield { type: 'done', reason: 'end_turn' as DoneReason }
        return
      }

      const toolResultContents: CoreContentBlock[] = []
      for (const toolUse of toolUses) {
        if (shouldAbort(abortSignal)) {
          toolResultContents.push(
            ...createSyntheticToolResults([assistantMessage!]),
          )
          break
        }

        const tool = this.deps.tools.find(toolUse.name)
        if (!tool) {
          toolResultContents.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Unknown tool: ${toolUse.name}`,
            is_error: true,
          })
          continue
        }

        const permissionResult = await this.deps.permission.canUseTool(
          tool,
          toolUse.input,
          { mode: 'default', input: toolUse.input },
        )

        if (!permissionResult.allowed) {
          toolResultContents.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Permission denied: ${permissionResult.reason}`,
            is_error: true,
          })
          continue
        }

        yield {
          type: 'tool_start',
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          input: toolUse.input,
        }

        try {
          const result: ToolResult = await this.deps.tools.execute(
            tool,
            toolUse.input,
            { abortSignal: abortSignal ?? new AbortController().signal, toolUseId: toolUse.id },
          )

          yield {
            type: 'tool_result',
            toolUseId: toolUse.id,
            result,
          }

          toolResultContents.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result.output,
            ...(result.error ? { is_error: true } : {}),
          })
        } catch (error) {
          const errorResult: ToolResult = {
            output: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
            error: true,
          }

          yield {
            type: 'tool_result',
            toolUseId: toolUse.id,
            result: errorResult,
          }

          toolResultContents.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: errorResult.output as string,
            is_error: true,
          })
        }
      }

      const toolResultMsg = this.createUserMessageFromBlocks(toolResultContents)
      messages = [...messages, toolResultMsg]
      yield { type: 'message', message: toolResultMsg }

      // --- Step 8: Compaction ---
      const totalTokens = this.aggregateUsage(messages)
      const compactionResult = await this.deps.compaction.maybeCompact(
        messages,
        totalTokens.input_tokens + totalTokens.output_tokens,
      )
      if (compactionResult.compacted) {
        yield {
          type: 'compaction',
          before: messages,
          after: compactionResult.messages,
        }
        messages = compactionResult.messages
      }

    }

    await this.deps.hooks.onTurnEnd(
      this.createAgentState(messages, turnCount),
    )
    yield { type: 'done', reason: 'max_turns' as DoneReason, usage: this.aggregateUsage(messages) }
  }


  private collectTools(): CoreTool[] {
    return this.deps.tools.list()
  }

  private createUserMessage(
    text: string,
    attachments?: Array<{ type: string; [key: string]: unknown }>,
  ): CoreUserMessage {
    const content: CoreContentBlock[] = []
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        content.push({ type: 'text', text: JSON.stringify(att) })
      }
    }
    content.push({ type: 'text', text })
    return {
      type: 'user',
      uuid: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      message: { role: 'user', content },
    }
  }

  private createUserMessageFromBlocks(
    blocks: CoreContentBlock[],
  ): CoreUserMessage {
    return {
      type: 'user',
      uuid: crypto.randomUUID(),
      role: 'user',
      content: blocks,
      timestamp: Date.now(),
      message: { role: 'user', content: blocks },
    }
  }

  private processStreamEvent(
    event: ProviderEvent,
    turnState: TurnState,
  ): void {
    if (event.type === 'message_start' && 'message' in event) {
      const msg = event.message as { usage?: Usage }
      if (msg.usage) {
        turnState.turnUsage = { ...msg.usage }
      }
    }
    if (event.type === 'content_block_start' && 'content_block' in event) {
      const block = event.content_block as { type: string; id?: string; name?: string; input?: unknown; text?: string; thinking?: string }
      if (block.type === 'tool_use' && block.id && block.name) {
        turnState.pendingToolUses.push({
          id: block.id,
          name: block.name,
          input: block.input ?? {},
        })
      } else if (block.type === 'text') {
        turnState.textBlocks.push({ type: 'text', text: '' })
        turnState.currentTextBlockIndex = turnState.textBlocks.length - 1
      } else if (block.type === 'thinking') {
        turnState.thinkingBlocks.push({ type: 'thinking', thinking: '' })
        turnState.currentThinkingBlockIndex = turnState.thinkingBlocks.length - 1
      }
    }
    if (event.type === 'content_block_delta') {
      const delta = (event as any).delta as { type?: string; text?: string; thinking?: string; partial_json?: string }
      if (delta?.type === 'text_delta' && delta.text != null && turnState.currentTextBlockIndex >= 0) {
        turnState.textBlocks[turnState.currentTextBlockIndex].text += delta.text
      } else if (delta?.type === 'thinking_delta' && delta.thinking != null && turnState.currentThinkingBlockIndex >= 0) {
        turnState.thinkingBlocks[turnState.currentThinkingBlockIndex].thinking += delta.thinking
      }
    }
    if (event.type === 'message_delta' && 'delta' in event) {
      const delta = event.delta as { stop_reason?: string }
      if (delta.stop_reason) {
        turnState.stopReason = delta.stop_reason
      }
      if ('usage' in event) {
        const usage = event.usage as { output_tokens: number }
        turnState.turnUsage.output_tokens += usage.output_tokens
      }
    }
  }

  private buildAssistantMessage(
    turnState: TurnState,
  ): CoreAssistantMessage {
    const content: CoreContentBlock[] = [
      ...turnState.thinkingBlocks,
      ...turnState.textBlocks,
      ...turnState.pendingToolUses.map(tu => ({
        type: 'tool_use' as const,
        id: tu.id,
        name: tu.name,
        input: tu.input,
      })),
    ]
    return {
      type: 'assistant',
      uuid: crypto.randomUUID(),
      role: 'assistant',
      content,
      usage: { ...turnState.turnUsage },
      stop_reason: turnState.stopReason,
      timestamp: Date.now(),
      message: {
        role: 'assistant',
        content,
        stop_reason: turnState.stopReason,
        usage: { ...turnState.turnUsage },
      },
    }
  }

  private extractToolUses(
    message: CoreAssistantMessage | null,
  ): Array<{ id: string; name: string; input: unknown }> {
    if (!message) return []
    const raw = message as any
    const content = Array.isArray(raw.content)
      ? raw.content
      : Array.isArray(raw.message?.content)
        ? raw.message.content
        : null
    if (!content) return []
    return content
      .filter(
        (block: any) =>
          typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_use',
      )
      .map((block: any) => ({
        id: block.id,
        name: block.name,
        input: block.input,
      }))
  }

  private aggregateUsage(messages: CoreMessage[]): Usage {
    const total: Usage = { input_tokens: 0, output_tokens: 0 }
    for (const msg of messages) {
      if (msg.type === 'assistant' && 'usage' in msg && msg.usage) {
        const usage = msg.usage as Usage
        total.input_tokens += usage.input_tokens
        total.output_tokens += usage.output_tokens
        if (usage.cache_creation_input_tokens) {
          total.cache_creation_input_tokens =
            (total.cache_creation_input_tokens ?? 0) + usage.cache_creation_input_tokens
        }
        if (usage.cache_read_input_tokens) {
          total.cache_read_input_tokens =
            (total.cache_read_input_tokens ?? 0) + usage.cache_read_input_tokens
        }
      }
    }
    return total
  }

  private createAgentState(messages: CoreMessage[], turnCount: number) {
    return {
      messages,
      turnCount,
      totalUsage: this.aggregateUsage(messages),
      model: this.deps.provider.getModel(),
      sessionId: this.deps.session.getSessionId(),
    }
  }
}
