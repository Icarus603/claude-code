import { getProviderAdapter } from '@claude-code/provider'
import type { Tools } from 'src/Tool.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from 'src/types/message.js'
import type { SystemPrompt } from 'src/utils/systemPromptType.js'
import type { ThinkingConfig } from 'src/utils/thinking.js'
import './providerHostSetup.js'
import type { Options } from '@claude-code/provider/claudeLegacy'

export * from '@claude-code/provider/claudeLegacy'

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
  const adapter = getProviderAdapter()
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
  const adapter = getProviderAdapter()
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
