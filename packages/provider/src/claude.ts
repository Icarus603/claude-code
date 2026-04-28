/**
 * claude — top-level provider router. `as any` casts bridge between the
 * router's input shape (Message[], SystemPrompt) and each provider
 * adapter's variant; by-design type-system bypass for SDK-to-SDK shape
 * translation across the multi-provider router seam.
 */
import { getProviderAdapter } from './index.js'
import type { Tools } from '@claude-code/tool-registry/Tool.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from '@claude-code/agent/messageShapes'
import type { SystemPrompt } from './systemPromptType.js'
import type { ThinkingConfig } from './thinking.js'
import './providerHostSetup.js'
import type { Options } from './claudeLegacy.js'

export * from './claudeLegacy.js'

export async function queryModelWithoutStreaming({
  messages,
  systemPrompt,
  thinkingConfig,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}): Promise<AssistantMessage> {
  // Per-model routing (V7 §11.6 Stage 2): when the user has connections[]
  // configured, this picks the right protocol for the chosen model.
  // Falls through to global `getAPIProvider()` when no connection matches.
  const adapter = getProviderAdapter(options.model)
  return (await adapter.query({
    messages,
    systemPrompt,
    thinkingConfig,
    tools,
    signal,
    options,
  } as any)) as unknown as AssistantMessage
}

export async function* queryModelWithStreaming({
  messages,
  systemPrompt,
  thinkingConfig,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  // Per-model routing (V7 §11.6 Stage 2): when the user has connections[]
  // configured, this picks the right protocol for the chosen model.
  // Falls through to global `getAPIProvider()` when no connection matches.
  const adapter = getProviderAdapter(options.model)
  yield* adapter.queryStream({
    messages,
    systemPrompt,
    thinkingConfig,
    tools,
    signal,
    options,
  } as any) as AsyncGenerator<
    StreamEvent | AssistantMessage | SystemAPIErrorMessage,
    void
  >
}
