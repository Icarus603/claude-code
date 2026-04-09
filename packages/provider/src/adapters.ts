import type {
  APIProvider,
  ProviderAdapter,
  ProviderAdapterOverrides,
  ProviderAvailability,
  ProviderQueryArgs,
} from './types.js'
import { getProviderContextPipeline } from './contextPipeline.js'
import { getProviderNetworkLayer } from './network.js'
import {
  anthropicAuthProvider,
  geminiAuthProvider,
  grokAuthProvider,
  openAIAuthProvider,
} from './auth.js'
import { getProviderHostBindings } from './host.js'
import { queryModelOpenAI } from './openai/indexImpl.js'
import { queryModelGemini } from './gemini/indexImpl.js'
import { queryModelGrok } from './grok/indexImpl.js'

function createAdapter(
  id: APIProvider,
  options: {
    queryStream: ProviderAdapter['queryStream']
    query?: ProviderAdapter['query']
    authProvider: ProviderAdapter['authProvider']
  },
): ProviderAdapter {
  return {
    id,
    authProvider: options.authProvider,
    contextPipeline: getProviderContextPipeline(),
    networkLayer: getProviderNetworkLayer(),
    query:
      options.query ??
      (async args => {
        let assistantMessage
        for await (const event of options.queryStream(args)) {
          if (event.type === 'assistant') {
            assistantMessage = event
          }
        }
        if (!assistantMessage) {
          throw new Error(`Provider ${id} did not yield an assistant message.`)
        }
        return assistantMessage
      }),
    queryStream: options.queryStream,
    listModels(fastMode?: boolean) {
      return getProviderHostBindings().getModelOptions(fastMode)
    },
    async isAvailable() {
      return options.authProvider.isAvailable()
    },
  }
}

export function getProviderAdapter(
  provider: APIProvider = getProviderHostBindings().getAPIProvider(),
  overrides: ProviderAdapterOverrides = {},
): ProviderAdapter {
  const hostBindings = getProviderHostBindings()
  switch (provider) {
    case 'openai':
      return createAdapter('openai', {
        authProvider: openAIAuthProvider,
        queryStream: args =>
          queryModelOpenAI(
            args.messages,
            args.systemPrompt,
            args.tools,
            args.signal,
            args.options,
          ),
      })
    case 'gemini':
      return createAdapter('gemini', {
        authProvider: geminiAuthProvider,
        queryStream: args =>
          queryModelGemini(
            args.messages,
            args.systemPrompt,
            args.tools,
            args.signal,
            args.options,
            args.thinkingConfig,
          ),
      })
    case 'grok':
      return createAdapter('grok', {
        authProvider: grokAuthProvider,
        queryStream: args =>
          queryModelGrok(
            args.messages,
            args.systemPrompt,
            args.tools,
            args.signal,
            args.options,
          ),
      })
    case 'bedrock':
    case 'vertex':
    case 'foundry':
    case 'firstParty':
    default:
      if (!overrides.anthropicQueryStream && !hostBindings.anthropic.queryStream) {
        throw new Error(
          `Provider ${provider} requires an Anthropic query stream implementation.`,
        )
      }
      return createAdapter(provider, {
        authProvider: anthropicAuthProvider,
        query: overrides.anthropicQuery ?? hostBindings.anthropic.query,
        queryStream:
          overrides.anthropicQueryStream ??
          (hostBindings.anthropic.queryStream as ProviderAdapter['queryStream']),
      })
  }
}
