
import { mock } from 'bun:test'
import type { AgentDeps } from '../index.js'

/**
 */
export function createMockDeps(overrides?: Partial<AgentDeps>): AgentDeps {
  return {
    provider: {
      stream: mock(async function* () {
        yield { type: 'message_stop' }
      }),
      getModel: mock(() => 'test-model'),
    },
    tools: {
      find: mock(() => undefined),
      list: mock(() => []),
      execute: mock(async () => ({ output: 'mock tool result' })),
    },
    permission: {
      canUseTool: mock(async () => ({ allowed: true })),
    },
    output: {
      emit: mock(() => {}),
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
      maybeCompact: mock(async () => ({
        compacted: false,
        messages: [],
      })),
    },
    context: {
      getSystemPrompt: mock(() => []),
      getUserContext: mock(() => ({})),
      getSystemContext: mock(() => ({})),
    },
    session: {
      recordTranscript: mock(async () => {}),
      getSessionId: mock(() => 'test-session-id'),
    },
    ...overrides,
  }
}

/**
 */
export function createMockStream(events: Array<{ type: string; [key: string]: unknown }>) {
  return mock(async function* () {
    for (const event of events) {
      yield event
    }
  })
}

/**
 */
export const END_TURN_EVENTS = [
  {
    type: 'message_start',
    message: {
      id: 'msg-test',
      model: 'test-model',
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  },
  {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Hello!' },
  },
  {
    type: 'content_block_stop',
    index: 0,
  },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 10 },
  },
  { type: 'message_stop' },
]

/**
 */
export function createToolUseStreamEvents(toolName: string, toolUseId: string) {
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg-test',
        model: 'test-model',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: toolUseId, name: toolName, input: {} },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{}' },
    },
    {
      type: 'content_block_stop',
      index: 0,
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 20 },
    },
    { type: 'message_stop' },
  ]
}
