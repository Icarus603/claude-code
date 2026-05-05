import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// Strategy: only mock the model + provider helpers. We do NOT mock
// `@claude-code/config/env/utils` — replacing that module breaks
// transitive consumers that need its other exports. Instead we drive
// the env override through real `process.env.WEB_SEARCH_ADAPTER`,
// which the factory reads via the live `readEnv()`.

let mockMainLoopModel: string | undefined
let mockMainLoopModelThrows = false
let mockSupportsServerWebSearch = false
let lastSupportsArg: string | undefined

const ENV_KEY = 'WEB_SEARCH_ADAPTER'
let envBackup: string | undefined

beforeEach(async () => {
  envBackup = process.env[ENV_KEY]
  delete process.env[ENV_KEY]

  mockMainLoopModel = 'claude-opus-4-7'
  mockMainLoopModelThrows = false
  mockSupportsServerWebSearch = false
  lastSupportsArg = undefined

  // Wrap real `model.js` so transitive consumers still see every
  // other export, but `getMainLoopModel` becomes test-controllable.
  const realModel = await import('@claude-code/provider/model.js')
  mock.module('@claude-code/provider/model.js', () => ({
    ...realModel,
    getMainLoopModel: () => {
      if (mockMainLoopModelThrows) {
        throw new Error('settings not loaded yet')
      }
      return mockMainLoopModel
    },
  }))

  // Same wrap-and-override for providers.js — preserves
  // `getAPIProvider`, `getProviderForModel`, etc. for other callers.
  const realProviders = await import('@claude-code/provider/providers.js')
  mock.module('@claude-code/provider/providers.js', () => ({
    ...realProviders,
    supportsAnthropicServerWebSearch: (modelId?: string) => {
      lastSupportsArg = modelId
      return mockSupportsServerWebSearch
    },
  }))
})

afterEach(() => {
  if (envBackup === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = envBackup
  }
  mock.restore()
})

async function freshFactory() {
  // Bun caches modules — append a unique query param to force a fresh
  // module evaluation that picks up the current `mock.module()` state.
  const factoryUrl = new URL(
    `../adapters/index.ts?t=${Date.now()}-${Math.random()}`,
    import.meta.url,
  )
  return (await import(factoryUrl.href)).createAdapter
}

describe('createAdapter — provider-aware routing', () => {
  test('returns ApiSearchAdapter when provider supports server tool', async () => {
    mockSupportsServerWebSearch = true
    const createAdapter = await freshFactory()
    const adapter = createAdapter()
    expect(adapter.constructor.name).toBe('ApiSearchAdapter')
    expect(lastSupportsArg).toBe('claude-opus-4-7')
  })

  test('returns BingSearchAdapter when provider does not support server tool', async () => {
    mockSupportsServerWebSearch = false
    const createAdapter = await freshFactory()
    const adapter = createAdapter()
    expect(adapter.constructor.name).toBe('BingSearchAdapter')
  })

  test('WEB_SEARCH_ADAPTER=bing forces Bing even when provider supports server tool', async () => {
    process.env[ENV_KEY] = 'bing'
    mockSupportsServerWebSearch = true
    const createAdapter = await freshFactory()
    const adapter = createAdapter()
    expect(adapter.constructor.name).toBe('BingSearchAdapter')
    expect(lastSupportsArg).toBeUndefined() // gating not consulted
  })

  test('WEB_SEARCH_ADAPTER=api forces Api even on non-Anthropic provider', async () => {
    process.env[ENV_KEY] = 'api'
    mockSupportsServerWebSearch = false
    const createAdapter = await freshFactory()
    const adapter = createAdapter()
    expect(adapter.constructor.name).toBe('ApiSearchAdapter')
    expect(lastSupportsArg).toBeUndefined()
  })

  test('WEB_SEARCH_ADAPTER override is case-insensitive', async () => {
    process.env[ENV_KEY] = 'API'
    mockSupportsServerWebSearch = false
    const createAdapter = await freshFactory()
    expect(createAdapter().constructor.name).toBe('ApiSearchAdapter')

    process.env[ENV_KEY] = 'Bing'
    mockSupportsServerWebSearch = true
    const createAdapter2 = await freshFactory()
    expect(createAdapter2().constructor.name).toBe('BingSearchAdapter')
  })

  test('unknown WEB_SEARCH_ADAPTER value falls through to provider routing', async () => {
    process.env[ENV_KEY] = 'duckduckgo'
    mockSupportsServerWebSearch = true
    const createAdapter = await freshFactory()
    expect(createAdapter().constructor.name).toBe('ApiSearchAdapter')
  })

  test('try/catch around getMainLoopModel routes Bing when gating returns false on undefined model', async () => {
    // Defensive belt-and-braces: in practice `createAdapter()` is only
    // ever called from `WebSearchTool.call()`, which runs after host
    // bindings are installed and `getMainLoopModel()` cannot throw.
    // The try/catch survives in case a future caller hits this path
    // earlier — exercise the catch branch + downstream gating here.
    mockMainLoopModelThrows = true
    mockSupportsServerWebSearch = false
    const createAdapter = await freshFactory()
    const adapter = createAdapter()
    expect(adapter.constructor.name).toBe('BingSearchAdapter')
    expect(lastSupportsArg).toBeUndefined()
  })

  test('try/catch around getMainLoopModel routes Api when gating returns true on undefined model', async () => {
    // Companion to the previous test — same defensive path, opposite
    // gating outcome. NB: in the real runtime this code path doesn't
    // fire because `supportsAnthropicServerWebSearch(undefined)` will
    // itself throw without host bindings; the test isolates the
    // factory's contract by mocking the gate.
    mockMainLoopModelThrows = true
    mockSupportsServerWebSearch = true
    const createAdapter = await freshFactory()
    expect(createAdapter().constructor.name).toBe('ApiSearchAdapter')
  })
})
