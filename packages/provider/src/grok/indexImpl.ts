import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import type {
  ProviderAssistantMessage,
  ProviderMessage,
  ProviderStreamEvent,
  ProviderSystemAPIErrorMessage,
  ProviderSystemPrompt,
  ProviderTools,
} from '../contracts.js'
import { getProviderHostBindings } from '../host.js'
import type { ProviderRequestOptions } from '../requestOptions.js'
import { getGrokClient } from './client.js'
import { resolveGrokModel } from './modelMapping.js'
import {
  anthropicMessagesToOpenAI,
} from '../openai/convertMessages.js'
import {
  anthropicToolChoiceToOpenAI,
  anthropicToolsToOpenAI,
} from '../openai/convertTools.js'
import { adaptOpenAIStreamToAnthropic } from '../openai/streamAdapter.js'

export async function* queryModelGrok(
  messages: readonly ProviderMessage[],
  systemPrompt: ProviderSystemPrompt,
  tools: ProviderTools,
  signal: AbortSignal,
  options: ProviderRequestOptions,
): AsyncGenerator<
  | ProviderStreamEvent
  | ProviderAssistantMessage
  | ProviderSystemAPIErrorMessage,
  void
> {
  try {
    const { runtime } = getProviderHostBindings()
    const grokModel = resolveGrokModel(options.model)
    const messagesForAPI = runtime.normalizeMessagesForAPI(messages, tools)

    const toolSchemas = await Promise.all(
      tools.map(tool =>
        runtime.toolToAPISchema(tool, {
          getToolPermissionContext: options.getToolPermissionContext,
          tools,
          agents: options.agents,
          allowedAgentTypes: options.allowedAgentTypes,
          model: options.model,
        }),
      ),
    )
    const standardTools = toolSchemas.filter(
      (tool): tool is BetaToolUnion & { type: string } => {
        const anyTool = tool as unknown as Record<string, unknown>
        return (
          anyTool.type !== 'advisor_20260301' &&
          anyTool.type !== 'computer_20250124'
        )
      },
    )

    const openaiMessages = anthropicMessagesToOpenAI(
      messagesForAPI,
      systemPrompt,
    )
    const openaiTools = anthropicToolsToOpenAI(standardTools)
    const openaiToolChoice = anthropicToolChoiceToOpenAI(options.toolChoice)

    const client = getGrokClient({
      maxRetries: 0,
      fetchOverride: options.fetchOverride as any,
      source: options.querySource,
    })

    runtime.logForDebugging(
      `[Grok] Calling model=${grokModel}, messages=${openaiMessages.length}, tools=${openaiTools.length}`,
    )

    const stream = await client.chat.completions.create(
      {
        model: grokModel,
        messages: openaiMessages,
        ...(openaiTools.length > 0 && {
          tools: openaiTools,
          ...(openaiToolChoice && { tool_choice: openaiToolChoice as any }),
        }),
        stream: true,
        stream_options: { include_usage: true },
        ...(options.temperatureOverride !== undefined && {
          temperature: options.temperatureOverride,
        }),
      },
      { signal },
    )

    const adaptedStream = adaptOpenAIStreamToAnthropic(stream, grokModel)
    const contentBlocks: Record<number, any> = {}
    let partialMessage: any = undefined
    let usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    let ttftMs = 0
    const start = Date.now()

    for await (const event of adaptedStream) {
      switch (event.type) {
        case 'message_start': {
          partialMessage = (event as any).message
          ttftMs = Date.now() - start
          if ((event as any).message?.usage) {
            usage = { ...usage, ...((event as any).message.usage as any) }
          }
          break
        }
        case 'content_block_start': {
          const idx = (event as any).index
          const contentBlock = (event as any).content_block
          if (contentBlock.type === 'tool_use') {
            contentBlocks[idx] = { ...contentBlock, input: '' }
          } else if (contentBlock.type === 'text') {
            contentBlocks[idx] = { ...contentBlock, text: '' }
          } else if (contentBlock.type === 'thinking') {
            contentBlocks[idx] = {
              ...contentBlock,
              thinking: '',
              signature: '',
            }
          } else {
            contentBlocks[idx] = { ...contentBlock }
          }
          break
        }
        case 'content_block_delta': {
          const idx = (event as any).index
          const delta = (event as any).delta
          const block = contentBlocks[idx]
          if (!block) break
          if (delta.type === 'text_delta') {
            block.text = (block.text || '') + delta.text
          } else if (delta.type === 'input_json_delta') {
            block.input = (block.input || '') + delta.partial_json
          } else if (delta.type === 'thinking_delta') {
            block.thinking = (block.thinking || '') + delta.thinking
          } else if (delta.type === 'signature_delta') {
            block.signature = delta.signature
          }
          break
        }
        case 'content_block_stop': {
          const idx = (event as any).index
          const block = contentBlocks[idx]
          if (!block || !partialMessage) break

          const message: ProviderAssistantMessage = {
            message: {
              ...partialMessage,
              content: runtime.normalizeContentFromAPI(
                [block],
                tools,
                options.agentId,
              ),
            },
            requestId: undefined,
            type: 'assistant',
            uuid: randomUUID(),
            timestamp: new Date().toISOString(),
          }
          yield message
          break
        }
        case 'message_delta': {
          const deltaUsage = (event as any).usage
          if (deltaUsage) {
            usage = { ...usage, ...deltaUsage }
          }
          break
        }
        case 'message_stop':
          break
      }

      if (
        event.type === 'message_stop' &&
        usage.input_tokens + usage.output_tokens > 0
      ) {
        const costUSD = runtime.calculateUSDCost(grokModel, usage as any)
        runtime.addToTotalSessionCost(costUSD, usage as any, options.model)
      }

      yield {
        type: 'stream_event',
        event,
        ...(event.type === 'message_start' ? { ttftMs } : undefined),
      } as ProviderStreamEvent
    }
  } catch (error) {
    const { runtime } = getProviderHostBindings()
    const errorMessage = error instanceof Error ? error.message : String(error)
    runtime.logForDebugging(`[Grok] Error: ${errorMessage}`, { level: 'error' })
    yield runtime.createAssistantAPIErrorMessage({
      content: `API Error: ${errorMessage}`,
      apiError: 'api_error',
      error: (error instanceof Error ? error : new Error(String(error))) as any,
    })
  }
}
