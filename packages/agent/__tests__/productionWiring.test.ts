import { describe, test, expect, mock } from 'bun:test'
import { AgentCore } from '../core/AgentCore.js'
import { createProductionDeps } from '../../../src/agent/createDeps.js'
import { getEmptyToolPermissionContext, type ToolUseContext, type Tools } from '../../../src/Tool.js'

describe('AgentCore production wiring', () => {
  test('runs through src/agent production adapters for tools and permissions', async () => {
    const tools: Tools = [
      {
        name: 'Echo',
        inputJSONSchema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
          },
        },
        isMcp: false,
        userFacingName: () => 'Echo',
        description: async () => 'Echo tool',
        prompt: async () => 'Echo prompt',
        isEnabled: () => true,
        isConcurrencySafe: () => true,
        isReadOnly: () => true,
        isDestructive: () => false,
        checkPermissions: async () => ({ behavior: 'allow' }),
        toAutoClassifierInput: (input: unknown) => input,
        mapToolResultToToolResultBlockParam: (content: string, toolUseID: string) => ({
          type: 'tool_result',
          tool_use_id: toolUseID,
          content,
        }),
        renderToolUseMessage: () => null,
        call: mock(async (input: { text: string }) => `echo:${input.text}`),
      } as any,
    ]

    const appState = {
      toolPermissionContext: getEmptyToolPermissionContext(),
      mcp: { tools: [], clients: [] },
    } as any

    const toolUseContext: ToolUseContext = {
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'test-model',
        fallbackModel: 'fallback-model',
        tools,
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      abortController: new AbortController(),
      readFileState: {} as any,
      renderedSystemPrompt: [{ content: 'System prompt from production wiring' }] as any,
      getAppState: () => appState,
      setAppState: updater => {
        Object.assign(appState, updater(appState))
      },
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
    } as ToolUseContext

    const deps = createProductionDeps({
      tools,
      toolUseContext,
      canUseTool: mock(async () => ({ behavior: 'allow' } as any)),
      querySource: 'sdk',
      contextOverrides: {
        systemPrompt: [{ content: 'System prompt from override' }],
        userContext: { env: 'test' },
        systemContext: { source: 'integration-test' },
      },
    })

    let callCount = 0
    deps.provider = {
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
    }

    deps.hooks = {
      onTurnStart: mock(async () => {}),
      onTurnEnd: mock(async () => {}),
      onStop: mock(async () => ({
        blockingErrors: [],
        preventContinuation: false,
      })),
    }

    deps.compaction = {
      maybeCompact: mock(async messages => ({
        compacted: false,
        messages,
      })),
    }

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
          event.message.content.some(block => block.type === 'text' && block.text === 'done'),
      ),
    ).toBe(true)
    expect(deps.hooks.onTurnStart).toHaveBeenCalled()
    expect(deps.hooks.onTurnEnd).toHaveBeenCalled()
  })
})
