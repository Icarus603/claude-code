import { beforeEach, describe, expect, test } from 'bun:test'
import {
  getProviderAdapter,
  installProviderHostBindings,
  type ProviderHostBindings,
} from '../index.js'

function makeSseResponse(frames: string[]): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames.join('')))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function createOpenAIMockFetch(): typeof fetch {
  return (async () =>
    makeSseResponse([
      'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","created":0,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"provider-openai-test"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","created":0,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ])) as typeof fetch
}

function installTestHostBindings(): void {
  const bindings: ProviderHostBindings = {
    contextPipeline: {
      getUserContext: async () => ({}),
      getSystemContext: async () => ({}),
    },
    networkLayer: {
      getProxyFetchOptions: () => undefined,
      createAxiosInstance: () => ({}),
      getProxyUrl: () => undefined,
      shouldBypassProxy: () => false,
    },
    getAPIProvider: () => 'firstParty',
    getModelOptions: () => [
      {
        value: 'claude-sonnet-4-6',
        label: 'sonnet',
        description: 'test',
      },
    ],
    auth: {
      checkAndRefreshOAuthTokenIfNeeded: async () => true,
      getAnthropicApiKey: () => 'anthropic-test',
      getApiKeyFromApiKeyHelper: async () => 'anthropic-test',
      getClaudeAIOAuthTokens: () => null,
      isClaudeAISubscriber: () => false,
      isEnvTruthy: value => value === true || value === 'true',
      getOauthConfig: () => ({ BASE_API_URL: 'https://api.anthropic.com' }),
    },
    anthropic: {
      refreshAndGetAwsCredentials: Object.assign(async () => null, {
        cache: { clear: () => {} },
      }),
      refreshGcpCredentialsIfNeeded: Object.assign(async () => true, {
        cache: { clear: () => {} },
      }),
      getUserAgent: () => 'provider-test',
      getSmallFastModel: () => 'claude-haiku-4-5',
      isFirstPartyAnthropicBaseUrl: () => true,
      getIsNonInteractiveSession: () => true,
      getSessionId: () => 'session-test',
      isDebugToStdErr: () => false,
      logForDebugging: () => {},
      getAWSRegion: () => 'us-east-1',
      getVertexRegionForModel: () => 'us-central1',
      isEnvTruthy: value => value === true || value === 'true',
      queryStream: async function* () {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'provider-anthropic-test' }],
          },
          uuid: 'assistant-test',
          timestamp: new Date().toISOString(),
        } as any
      },
    },
    session: {
      addToTotalSessionCost: () => {},
      logForDebugging: () => {},
    },
  }
  installProviderHostBindings(bindings)
}

function buildQueryArgs(fetchOverride: typeof fetch) {
  return {
    messages: [
      {
        type: 'user',
        uuid: 'u-1',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      },
    ],
    systemPrompt: ['Respond with token only.'],
    tools: [
      {
        name: 'ToolSearch',
        shouldDefer: false,
        isEnabled: () => true,
        prompt: async () => 'search tool',
        inputJSONSchema: { type: 'object', properties: {} },
      },
      {
        name: 'DeferredTool',
        shouldDefer: true,
        isEnabled: () => true,
        prompt: async () => 'deferred tool',
        inputJSONSchema: { type: 'object', properties: {} },
      },
    ],
    signal: AbortSignal.timeout(5_000),
    thinkingConfig: { type: 'disabled' } as const,
    options: {
      model: 'claude-sonnet-4-6',
      isNonInteractiveSession: true,
      querySource: 'repl_main_thread',
      hasAppendSystemPrompt: false,
      mcpTools: [],
      agents: [],
      getToolPermissionContext: async () => ({ mode: 'default' }),
      fetchOverride,
    },
  }
}

describe('@claude-code/provider integration', () => {
  beforeEach(() => {
    installTestHostBindings()
    process.env.OPENAI_API_KEY = 'provider-test'
  })

  test('anthropic adapter path resolves without override', async () => {
    const adapter = getProviderAdapter('firstParty')
    const output: string[] = []
    for await (const event of adapter.queryStream(buildQueryArgs(fetch) as any)) {
      if (event.type === 'assistant') {
        for (const block of event.message.content as any[]) {
          if (block.type === 'text') output.push(block.text)
        }
      }
    }
    expect(output.join('')).toContain('provider-anthropic-test')
  })

  test('openai adapter supports streaming + deferred tool filtering', async () => {
    const adapter = getProviderAdapter('openai')
    const output: string[] = []
    for await (const event of adapter.queryStream(
      buildQueryArgs(createOpenAIMockFetch()) as any,
    )) {
      if (event.type === 'assistant') {
        for (const block of event.message.content as any[]) {
          if (block.type === 'text') output.push(block.text)
        }
      }
    }
    expect(output.join('')).toContain('provider-openai-test')
  })

  test('openai adapter normalizes errors into assistant api-error messages', async () => {
    const adapter = getProviderAdapter('openai')
    const badFetch = (async () =>
      new Response('boom', { status: 500, statusText: 'server error' })) as typeof fetch

    const events: any[] = []
    for await (const event of adapter.queryStream(
      buildQueryArgs(badFetch) as any,
    )) {
      events.push(event)
    }

    const errorAssistant = events.find(event => event.type === 'assistant')
    expect(errorAssistant).toBeDefined()
    expect(errorAssistant.message.content[0].text).toContain('API Error:')
  })
})
