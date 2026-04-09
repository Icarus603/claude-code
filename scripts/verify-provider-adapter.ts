import { getProviderAdapter } from '@claude-code/provider'
import '../src/services/api/providerHostSetup.js'
import { getEmptyToolPermissionContext } from '../src/Tool.js'
import { createUserMessage } from '../src/utils/messages.js'
import { enableConfigs } from '@claude-code/config'
import { asSystemPrompt } from '../src/utils/systemPromptType.js'

function makeSseResponse(frames: string[]): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames.join('')))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
    },
  })
}

function createOpenAIMockFetch(): typeof fetch {
  return (async () =>
    makeSseResponse([
      'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","created":0,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"provider-openai-ok"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","created":0,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ])) as typeof fetch
}

function createGeminiMockFetch(): typeof fetch {
  return (async () =>
    makeSseResponse([
      'event: message\n',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"provider-gemini-ok"}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"totalTokenCount":5}}\n\n',
      'data: [DONE]\n\n',
    ])) as typeof fetch
}

async function collectAnthropicText(): Promise<string> {
  const adapter = getProviderAdapter('firstParty', {
    anthropicQueryStream: async function* () {
      yield {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'provider-anthropic-ok' }],
        },
        uuid: 'anthropic-test',
        timestamp: new Date().toISOString(),
      } as any
    },
  })

  let text = ''
  for await (const event of adapter.queryStream({
    messages: [
      createUserMessage({
        content: 'verify anthropic',
      }),
    ],
    systemPrompt: asSystemPrompt(['Respond with the verification token only.']),
    tools: [],
    signal: AbortSignal.timeout(5_000),
    thinkingConfig: { type: 'disabled' },
    options: {
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      model: 'claude-sonnet-4-6',
      isNonInteractiveSession: true,
      querySource: 'repl_main_thread',
      agents: [],
      hasAppendSystemPrompt: false,
      mcpTools: [],
    },
  })) {
    if (event.type === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'text') {
          text += block.text
        }
      }
    }
  }
  return text
}

async function collectAssistantText(
  provider: 'openai' | 'gemini',
  fetchOverride: typeof fetch,
): Promise<string> {
  const adapter = getProviderAdapter(provider)
  const availability = await adapter.isAvailable()
  if (!availability.available) {
    throw new Error(`${provider} adapter unavailable: ${availability.reason}`)
  }

  const models = adapter.listModels(false)
  if (models.length === 0) {
    throw new Error(`${provider} adapter returned no model options`)
  }

  let text = ''
  for await (const event of adapter.queryStream({
    messages: [
      createUserMessage({
        content: `verify ${provider}`,
      }),
    ],
    systemPrompt: asSystemPrompt(['Respond with the verification token only.']),
    tools: [],
    signal: AbortSignal.timeout(5_000),
    thinkingConfig: { type: 'disabled' },
    options: {
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      model: 'claude-sonnet-4-6',
      isNonInteractiveSession: true,
      querySource: 'repl_main_thread',
      agents: [],
      hasAppendSystemPrompt: false,
      mcpTools: [],
      fetchOverride,
    },
  })) {
    if (event.type === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'text') {
          text += block.text
        }
      }
    }
  }

  return text
}

async function main(): Promise<void> {
  enableConfigs()

  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'provider-test'
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'provider-test'
  process.env.GEMINI_MODEL =
    process.env.GEMINI_MODEL || 'models/gemini-2.5-pro'

  const anthropicText = await collectAnthropicText()
  if (!anthropicText.includes('provider-anthropic-ok')) {
    throw new Error(
      `Anthropic adapter returned unexpected text: ${anthropicText}`,
    )
  }

  const openaiText = await collectAssistantText(
    'openai',
    createOpenAIMockFetch(),
  )
  if (!openaiText.includes('provider-openai-ok')) {
    throw new Error(`OpenAI adapter returned unexpected text: ${openaiText}`)
  }

  const geminiText = await collectAssistantText(
    'gemini',
    createGeminiMockFetch(),
  )
  if (!geminiText.includes('provider-gemini-ok')) {
    throw new Error(`Gemini adapter returned unexpected text: ${geminiText}`)
  }

  const contextPipeline = getProviderAdapter('openai').contextPipeline
  await contextPipeline.getUserContext()
  await contextPipeline.getSystemContext()

  const networkLayer = getProviderAdapter('openai').networkLayer
  networkLayer.getProxyFetchOptions({ forAnthropicAPI: false })

  console.log('provider adapter verification passed')
}

await main()
process.exit(0)
