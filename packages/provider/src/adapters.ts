import type {
  APIProvider,
  ProviderAdapter,
  ProviderAdapterOverrides,
  ProviderAvailability,
  ProviderQueryArgs,
} from './types.js'
import type { ProviderRequestOptions } from './requestOptions.js'
import { getProviderContextPipeline } from './contextPipeline.js'
import { getProviderNetworkLayer } from './network.js'
import {
  anthropicAuthProvider,
  geminiAuthProvider,
  openAIAuthProvider,
} from './auth.js'
import { getProviderHostBindings } from './host.js'
import { HostBindingsError, StreamError } from './errors.js'
import { queryModelOpenAI } from './openai/indexImpl.js'
import { queryModelGemini } from './gemini/indexImpl.js'
import { getProviderForModel } from './providers.js'
import { unpackModelId } from './connections.js'

// Centralized so `getProviderAdapter` can disambiguate "you passed me a
// provider id" from "you passed me a model id". Adding a new APIProvider
// must update both this set AND the union in ./types.ts.
const API_PROVIDER_VALUES: ReadonlySet<APIProvider> = new Set<APIProvider>([
  'firstParty',
  'bedrock',
  'vertex',
  'foundry',
  'openai',
  'gemini',
  'codex',
])

function isAPIProviderValue(value: string): value is APIProvider {
  return API_PROVIDER_VALUES.has(value as APIProvider)
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
          throw new StreamError(
            `Provider ${id} did not yield an assistant message.`,
          )
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

/**
 * Resolve the adapter for a request.
 *
 * @param providerOrModel  Either:
 *   - an explicit `APIProvider` (legacy callers know what they want), OR
 *   - a model id string — when present, route via `getProviderForModel`
 *     so connection-registry users get the connection's protocol, not the
 *     global `getAPIProvider()` fallback.
 *   When omitted, fall back to global provider (env-var driven).
 *
 * V7 §11.6 connection routing — Stage 2 of multi-provider coexistence.
 * Without this, `connections[]` was decorative: query path always read
 * `getAPIProvider()` (global modelType + env vars), so picking
 * `[ChatGPT Codex] gpt-5.2-codex` from the model picker still hit the
 * Anthropic stream and 404'd.
 */
export function getProviderAdapter(
  providerOrModel?: APIProvider | string,
  overrides: ProviderAdapterOverrides = {},
): ProviderAdapter {
  const hostBindings = getProviderHostBindings()
  const provider: APIProvider = (() => {
    if (providerOrModel === undefined) {
      return hostBindings.getAPIProvider()
    }
    // Heuristic: APIProvider values are short tokens with no '/' or '-';
    // model ids almost always contain a '-' or version suffix.
    if (isAPIProviderValue(providerOrModel)) {
      return providerOrModel
    }
    return getProviderForModel(providerOrModel)
  })()

  // Strip the connection-id prefix from `options.model` before passing to
  // upstream APIs. The picker emits "<connId>:<modelId>" so multiple
  // connections sharing a model name disambiguate. Adapters / SDKs only
  // see the bare model id. resolveConnectionForModel did the routing
  // above; the prefix is no longer needed.
  const stripModelPrefix = (
    args: ProviderQueryArgs,
  ): ProviderQueryArgs => {
    const opts = args.options
    if (!opts.model) return args
    const { connectionId, modelId } = unpackModelId(opts.model)
    if (!connectionId) return args
    return { ...args, options: { ...opts, model: modelId } }
  }
  // Codex requests intentionally are NOT routed here — they flow
  // through the Anthropic SDK path with a `fetch` override installed
  // in `getAnthropicClient` (`anthropic/client.ts`). The override sees
  // the final wire body and translates at that seam, which is much less
  // fragile than translating Claude Code's internal Message[] shape.
  // Keeping a parallel adapter here would create two ways to hit Codex
  // and two impedance-match seams to maintain.
  switch (provider) {
    case 'openai':
      return createAdapter('openai', {
        authProvider: openAIAuthProvider,
        queryStream: rawArgs => {
          const args = stripModelPrefix(rawArgs)
          return queryModelOpenAI(
            args.messages,
            args.systemPrompt,
            args.tools,
            args.signal,
            args.options,
          )
        },
      })
    case 'gemini':
      return createAdapter('gemini', {
        authProvider: geminiAuthProvider,
        queryStream: rawArgs => {
          const args = stripModelPrefix(rawArgs)
          return queryModelGemini(
            args.messages,
            args.systemPrompt,
            args.tools,
            args.signal,
            args.options,
            args.thinkingConfig,
          )
        },
      })
    case 'bedrock':
    case 'vertex':
    case 'foundry':
    case 'firstParty':
    default:
      if (!overrides.anthropicQueryStream && !hostBindings.anthropic.queryStream) {
        throw new HostBindingsError(
          `Provider ${provider} requires an Anthropic query stream implementation.`,
        )
      }
      // Anthropic queryStream already accepts ProviderQueryArgs; wrap it
      // to strip the prefix at the same seam as the other adapters.
      const anthropicQueryStream =
        overrides.anthropicQueryStream ??
        (hostBindings.anthropic.queryStream as ProviderAdapter['queryStream'])
      return createAdapter(provider, {
        authProvider: anthropicAuthProvider,
        query: overrides.anthropicQuery ?? hostBindings.anthropic.query,
        queryStream: rawArgs => anthropicQueryStream(stripModelPrefix(rawArgs)),
      })
  }
}
