/**
 * @claude-code/agent/testing
 *
 * V7 §9.11 — public in-memory seams for agent package tests.
 * Must NOT import from ../internal/.
 */
import type {
  AgentDeps,
  AgentEvent,
  AgentInput,
  CompactionResult,
  CoreTool,
  PermissionResult,
  ProviderEvent,
  ProviderStreamParams,
  StopHookResult,
  ToolResult,
} from '../index.js'
import { AgentCore } from '../core/AgentCore.js'

export type ScriptedProviderStep =
  | { kind: 'events'; events: ProviderEvent[] }
  | { kind: 'error'; error: unknown }

/**
 * Builds a hermetic AgentDeps object with controllable provider/tool behavior.
 */
export function createMockDeps(overrides?: Partial<AgentDeps>): AgentDeps {
  return {
    provider: {
      async *stream(_params: ProviderStreamParams): AsyncIterable<ProviderEvent> {
        yield { type: 'message_stop' }
      },
      getModel: () => 'test-model',
    },
    tools: {
      find: (_name: string) => undefined,
      list: () => [],
      execute: async (_tool: CoreTool, _input: unknown) =>
        ({ output: 'mock tool result' }) as ToolResult,
    },
    permission: {
      canUseTool: async (): Promise<PermissionResult> =>
        ({ allowed: true }) as PermissionResult,
    },
    output: {
      emit: (_event: unknown) => {},
    },
    hooks: {
      onTurnStart: async () => {},
      onTurnEnd: async () => {},
      onStop: async (): Promise<StopHookResult> => ({
        blockingErrors: [],
        preventContinuation: false,
      }),
    },
    compaction: {
      maybeCompact: async (messages: any[]): Promise<CompactionResult> => ({
        compacted: false,
        messages,
      }),
    },
    context: {
      getSystemPrompt: () => [],
      getUserContext: () => ({}),
      getSystemContext: () => ({}),
    },
    session: {
      recordTranscript: async () => {},
      getSessionId: () => 'test-session-id',
    },
    ...overrides,
  }
}

/**
 * Provider stream helper for deterministic turn scripts.
 */
export function createMockStream(
  events: Array<{ type: string; [key: string]: unknown }>,
): AgentDeps['provider']['stream'] {
  return async function* () {
    for (const event of events) {
      yield event as ProviderEvent
    }
  }
}

/**
 * Scripted provider that can return several turns in sequence.
 */
export function createScriptedProvider(
  steps: ScriptedProviderStep[],
): AgentDeps['provider'] {
  let index = 0
  return {
    async *stream(_params: ProviderStreamParams): AsyncIterable<ProviderEvent> {
      const step = steps[index++] ?? { kind: 'events', events: [] }
      if (step.kind === 'error') {
        throw step.error
      }
      for (const event of step.events) {
        yield event
      }
    },
    getModel: () => 'test-model',
  }
}

/**
 * Minimal harness for exercising AgentCore with explicit deps.
 */
export async function collectAgentEvents(
  deps: AgentDeps,
  input: AgentInput,
): Promise<AgentEvent[]> {
  const core = new AgentCore(deps)
  const events: AgentEvent[] = []
  for await (const event of core.run(input)) {
    events.push(event)
  }
  return events
}
