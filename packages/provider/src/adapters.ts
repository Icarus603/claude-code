import {
  getAPIProvider,
  type APIProvider,
} from '../../../src/utils/model/providers.js'
import { getModelOptions } from '../../../src/utils/model/modelOptions.js'
import type {
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

async function* queryOpenAI(args: ProviderQueryArgs) {
  const { queryModelOpenAI } = await import(
    '../../../src/services/api/openai/index.js'
  )
  yield* queryModelOpenAI(
    args.messages,
    args.systemPrompt,
    args.tools,
    args.signal,
    args.options,
  )
}

async function* queryGemini(args: ProviderQueryArgs) {
  const { queryModelGemini } = await import(
    '../../../src/services/api/gemini/index.js'
  )
  yield* queryModelGemini(
    args.messages,
    args.systemPrompt,
    args.tools,
    args.signal,
    args.options,
    args.thinkingConfig,
  )
}

async function* queryGrok(args: ProviderQueryArgs) {
  const { queryModelGrok } = await import(
    '../../../src/services/api/grok/index.js'
  )
  yield* queryModelGrok(
    args.messages,
    args.systemPrompt,
    args.tools,
    args.signal,
    args.options,
  )
}

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
      return getModelOptions(fastMode)
    },
    async isAvailable() {
      return options.authProvider.isAvailable()
    },
  }
}

export function getProviderAdapter(
  provider: APIProvider = getAPIProvider(),
  overrides: ProviderAdapterOverrides = {},
): ProviderAdapter {
  switch (provider) {
    case 'openai':
      return createAdapter('openai', {
        authProvider: openAIAuthProvider,
        queryStream: args => queryOpenAI(args),
      })
    case 'gemini':
      return createAdapter('gemini', {
        authProvider: geminiAuthProvider,
        queryStream: args => queryGemini(args),
      })
    case 'grok':
      return createAdapter('grok', {
        authProvider: grokAuthProvider,
        queryStream: args => queryGrok(args),
      })
    case 'bedrock':
    case 'vertex':
    case 'foundry':
    case 'firstParty':
    default:
      if (!overrides.anthropicQueryStream) {
        throw new Error(
          `Provider ${provider} requires an Anthropic query adapter override.`,
        )
      }
      return createAdapter(provider, {
        authProvider: anthropicAuthProvider,
        query: overrides.anthropicQuery,
        queryStream: overrides.anthropicQueryStream,
      })
  }
}
