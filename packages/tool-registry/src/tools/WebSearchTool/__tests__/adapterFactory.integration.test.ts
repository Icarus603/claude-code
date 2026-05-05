// Integration test for createAdapter — exercises the REAL
// `supportsAnthropicServerWebSearch` chain by mocking only `getGlobalConfig`
// + `getInitialSettings` + `getMainLoopModel`. Pre-v26.5.26 the WebSearch
// routing was broken because `getProviderForModel` returned the literal
// string 'anthropic' for `protocol='anthropic'` connections, hitting the
// predicate's default-false branch.
//
// Lives in its own file (not adapterFactory.test.ts) because that file
// mocks `supportsAnthropicServerWebSearch` directly and the outer
// `beforeEach` would clobber the integration mocks set up here.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ConnectionRecord } from '@claude-code/config'

const realConfig = await import('@claude-code/config')
const config = { connections: [] as ConnectionRecord[] }
mock.module('@claude-code/config', () => ({
  ...realConfig,
  getGlobalConfig: () => config,
}))

const realSettings = await import('@claude-code/config/settings')
mock.module('@claude-code/config/settings', () => ({
  ...realSettings,
  getInitialSettings: () => ({}),
}))

const realModel = await import('@claude-code/provider/model.js')
let currentMainLoopModel = 'claude-account:claude-opus-4-7'
mock.module('@claude-code/provider/model.js', () => ({
  ...realModel,
  getMainLoopModel: () => currentMainLoopModel,
}))

const baseConn = {
  auth: { type: 'api_key' as const, key: 'k' },
  enabled: true,
  createdAt: 0,
}

let envBackup: string | undefined

beforeEach(() => {
  envBackup = process.env.WEB_SEARCH_ADAPTER
  delete process.env.WEB_SEARCH_ADAPTER
  config.connections = []
  currentMainLoopModel = 'claude-account:claude-opus-4-7'
})

afterEach(() => {
  if (envBackup === undefined) delete process.env.WEB_SEARCH_ADAPTER
  else process.env.WEB_SEARCH_ADAPTER = envBackup
})

async function freshFactory() {
  const url = new URL(
    `../adapters/index.ts?integ=${Date.now()}-${Math.random()}`,
    import.meta.url,
  )
  return (await import(url.href)).createAdapter
}

describe('createAdapter — connection-routed integration (v26.5.26 leak fix)', () => {
  test('Pro/Max OAuth connection (api.anthropic.com) → ApiSearchAdapter (THE BUG FIX)', async () => {
    config.connections = [
      {
        ...baseConn,
        id: 'claude-account',
        name: 'Claude Account',
        protocol: 'anthropic',
        endpoint: 'https://api.anthropic.com',
        models: [{ id: 'claude-opus-4-7', label: 'Opus 4.7' }],
      },
    ]
    currentMainLoopModel = 'claude-account:claude-opus-4-7'
    expect((await freshFactory())().constructor.name).toBe('ApiSearchAdapter')
  })

  test('Console api_key connection on api.anthropic.com → ApiSearchAdapter', async () => {
    config.connections = [
      {
        ...baseConn,
        id: 'anthropic-console',
        name: 'Anthropic Console',
        protocol: 'anthropic',
        endpoint: 'https://api.anthropic.com',
        models: [{ id: 'claude-opus-4-7', label: 'Opus 4.7' }],
      },
    ]
    currentMainLoopModel = 'anthropic-console:claude-opus-4-7'
    expect((await freshFactory())().constructor.name).toBe('ApiSearchAdapter')
  })

  test('OpenAI connection → BingSearchAdapter', async () => {
    config.connections = [
      {
        ...baseConn,
        id: 'openai',
        name: 'OpenAI',
        protocol: 'openai',
        endpoint: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
      },
    ]
    currentMainLoopModel = 'openai:gpt-5.5'
    expect((await freshFactory())().constructor.name).toBe('BingSearchAdapter')
  })

  test('Anthropic-compat proxy on third-party host → still ApiSearchAdapter at this layer', async () => {
    // Documented behavior: WebSearch routing accepts any anthropic-protocol
    // connection. Some proxies forward server tools; those that don't will
    // return an API error the user can see and override via
    // `WEB_SEARCH_ADAPTER=bing`. The endpoint distinction matters for FGTS
    // (legacy/api.ts) — that gate uses `isFirstPartyAnthropicEndpoint` —
    // but not here.
    config.connections = [
      {
        ...baseConn,
        id: 'litellm',
        name: 'LiteLLM',
        protocol: 'anthropic',
        endpoint: 'https://my-proxy.example.com/anthropic',
        models: [{ id: 'claude-opus-4-7', label: 'Opus 4.7' }],
      },
    ]
    currentMainLoopModel = 'litellm:claude-opus-4-7'
    expect((await freshFactory())().constructor.name).toBe('ApiSearchAdapter')
  })
})
