import { describe, test, expect, mock } from 'bun:test'
import { AgentCore } from '../core/AgentCore.js'
import { createMockDeps } from './fixtures/mockDeps.js'

describe('AgentCore production wiring', () => {
  test('runs through src/agent production adapters for tools and permissions', async () => {
    const echoTool = {
      name: 'Echo',
      inputJSONSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
      },
    }

    let callCount = 0
    const deps = createMockDeps({
      provider: {
        getModel: () => 'test-model',
        stream: mock(async function* () {
          callCount++
          if (callCount === 1) {
            yield {
              type: 'message_start',
              message: {
                id: 'msg-tool',
                model: 'test-model',
                usage: { input_tokens: 5, output_tokens: 1 },
              },
            }
            yield {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'tool_use',
                id: 'toolu_echo',
                name: 'Echo',
                input: { text: 'hello' },
              },
            }
            yield {
              type: 'message_delta',
              delta: { stop_reason: 'tool_use' },
              usage: { output_tokens: 1 },
            }
            yield { type: 'message_stop' }
            return
          }

          yield {
            type: 'message_start',
            message: {
              id: 'msg-final',
              model: 'test-model',
              usage: { input_tokens: 10, output_tokens: 4 },
            },
          }
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'done' },
          }
          yield {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 4 },
          }
          yield { type: 'message_stop' }
        }),
      },
      tools: {
        find: mock((name: string) => name === 'Echo' ? echoTool : undefined),
        list: mock(() => [echoTool]),
        execute: mock(async (tool: { name: string }, input: { text: string }) =>
          ({ output: `echo:${input.text}` }),
        ),
      },
      hooks: {
        onTurnStart: mock(async () => {}),
        onTurnEnd: mock(async () => {}),
        onStop: mock(async () => ({
          blockingErrors: [],
          preventContinuation: false,
        })),
      },
      compaction: {
        maybeCompact: mock(async (messages: unknown[]) => ({
          compacted: false,
          messages,
        })),
      },
    })

    const core = new AgentCore(deps)
    const events = []
    for await (const event of core.run({ messages: [], prompt: 'start' })) {
      events.push(event)
    }

    expect(events.some(event => event.type === 'tool_start')).toBe(true)
    expect(events.some(event => event.type === 'tool_result')).toBe(true)
    expect(events.some(event => event.type === 'done')).toBe(true)
    expect(
      events.some(
        event =>
          event.type === 'message' &&
          event.message.type === 'assistant' &&
          Array.isArray(event.message.content) &&
          event.message.content.some((block: { type: string; text?: string }) => block.type === 'text' && block.text === 'done'),
      ),
    ).toBe(true)
    expect(deps.hooks.onTurnStart).toHaveBeenCalled()
    expect(deps.hooks.onTurnEnd).toHaveBeenCalled()
  })
})
