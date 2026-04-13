/**
 * V7 testing seams for @claude-code/provider.
 *
 * Lightweight fakes that satisfy the ProviderAdapter contract without
 * touching real networks, auth, or host bindings.
 *
 * Must NOT reach into the package's internal subtree (V7 §9.11).
 */

import { randomUUID } from 'crypto'
import type {
  ProviderAdapter,
  ProviderAvailability,
  ProviderQueryArgs,
  ProviderQueryStream,
} from '../types.js'
import type {
  ProviderAssistantMessage,
  ProviderStreamEvent,
} from '../contracts.js'
import { ProviderBaseError } from '../errors.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function stubAvailability(): Promise<ProviderAvailability> {
  return Promise.resolve({ available: true })
}

const stubAuth = {
  id: 'test',
  refresh: () => Promise.resolve(),
  getCredentials: () => Promise.resolve({}),
  isAvailable: stubAvailability,
}

const stubContext = {
  getUserContext: () => Promise.resolve({}),
  getSystemContext: () => Promise.resolve({}),
}

const stubNetwork = {
  getProxyFetchOptions: () => undefined,
  createAxiosInstance: () => ({}),
  getProxyUrl: () => undefined,
  shouldBypassProxy: () => false,
}

function makeAssistantMessage(
  text: string,
): ProviderAssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  } as ProviderAssistantMessage
}

// ---------------------------------------------------------------------------
// InMemoryProvider
// ---------------------------------------------------------------------------

export function createInMemoryProvider(
  responseText = 'Hello from InMemoryProvider',
): ProviderAdapter {
  const msg = makeAssistantMessage(responseText)
  return {
    id: 'firstParty',
    authProvider: stubAuth,
    contextPipeline: stubContext,
    networkLayer: stubNetwork,
    query: async (_args: ProviderQueryArgs) => msg,
    async *queryStream(_args: ProviderQueryArgs): ProviderQueryStream {
      const event: ProviderStreamEvent = {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: responseText },
      } as unknown as ProviderStreamEvent
      yield event
      yield msg
    },
    listModels: () => [
      { value: 'test-model', label: 'Test', description: 'In-memory test model' },
    ],
    isAvailable: stubAvailability,
  }
}

// ---------------------------------------------------------------------------
// ErroringProvider
// ---------------------------------------------------------------------------

export function createErroringProvider(
  errorMessage = 'Intentional test error',
): ProviderAdapter {
  const err = new ProviderBaseError('PROVIDER_TEST_ERROR', errorMessage)
  return {
    id: 'firstParty',
    authProvider: stubAuth,
    contextPipeline: stubContext,
    networkLayer: stubNetwork,
    query: async (_args: ProviderQueryArgs) => {
      throw err
    },
    async *queryStream(_args: ProviderQueryArgs): ProviderQueryStream {
      throw err
    },
    listModels: () => [],
    isAvailable: stubAvailability,
  }
}

// ---------------------------------------------------------------------------
// SlowProvider
// ---------------------------------------------------------------------------

export function createSlowProvider(
  delayMs = 1000,
  responseText = 'Hello from SlowProvider',
): ProviderAdapter {
  const msg = makeAssistantMessage(responseText)
  const delay = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('Aborted'))
      })
    })

  return {
    id: 'firstParty',
    authProvider: stubAuth,
    contextPipeline: stubContext,
    networkLayer: stubNetwork,
    query: async (args: ProviderQueryArgs) => {
      await delay(args.signal)
      return msg
    },
    async *queryStream(args: ProviderQueryArgs): ProviderQueryStream {
      await delay(args.signal)
      yield msg
    },
    listModels: () => [
      { value: 'slow-model', label: 'Slow', description: 'Delayed test model' },
    ],
    isAvailable: stubAvailability,
  }
}
