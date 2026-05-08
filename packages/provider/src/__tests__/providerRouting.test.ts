import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ConnectionRecord } from '@claude-code/config'

const realConfigModule = await import('@claude-code/config')
const config = {
  connections: [] as ConnectionRecord[],
}

mock.module('@claude-code/config', () => ({
  ...realConfigModule,
  getGlobalConfig: () => config,
}))

// `getAPIProvider()` calls `getInitialSettings()` from config/settings,
// which requires host bindings to be installed at runtime. Tests don't
// install bindings — stub a minimal settings object so the env-fallback
// branches of getProviderForModel / isFirstPartyAnthropicEndpoint can run.
const realSettingsModule = await import('@claude-code/config/settings')
mock.module('@claude-code/config/settings', () => ({
  ...realSettingsModule,
  getInitialSettings: () => ({}),
}))

const { getProviderForModel, isFirstPartyAnthropicEndpoint } = await import(
  '../providers.js'
)

const TRACKED_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
] as const
const savedEnv = new Map<string, string | undefined>()

beforeEach(() => {
  config.connections = []
  for (const k of TRACKED_KEYS) {
    savedEnv.set(k, process.env[k])
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of TRACKED_KEYS) {
    const v = savedEnv.get(k)
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  savedEnv.clear()
})

const baseConn = {
  id: 'test',
  name: 'Test',
  auth: { type: 'api_key' as const, key: 'k' },
  enabled: true,
  models: [{ id: 'claude-opus-4-7', label: 'Opus 4.7' }],
  createdAt: 0,
}

describe('getProviderForModel — protocol → APIProvider translation', () => {
  test('no connection match → falls back to getAPIProvider() (firstParty default)', () => {
    expect(getProviderForModel('claude-opus-4-7')).toBe('firstParty')
  })

  test('protocol="anthropic" connection → "firstParty" (was leaking "anthropic" pre-v26.5.26)', () => {
    config.connections = [
      { ...baseConn, protocol: 'anthropic', endpoint: 'https://api.anthropic.com' },
    ]
    expect(getProviderForModel('test:claude-opus-4-7')).toBe('firstParty')
  })

  test('protocol="anthropic" connection on a proxy endpoint → still "firstParty" (use isFirstPartyAnthropicEndpoint to distinguish)', () => {
    config.connections = [
      {
        ...baseConn,
        protocol: 'anthropic',
        endpoint: 'https://my-litellm.example.com/anthropic',
      },
    ]
    expect(getProviderForModel('test:claude-opus-4-7')).toBe('firstParty')
  })

  test('protocol="openai" connection → "openai"', () => {
    config.connections = [
      {
        ...baseConn,
        protocol: 'openai',
        endpoint: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
      },
    ]
    expect(getProviderForModel('test:gpt-5.5')).toBe('openai')
  })

  test('protocol="gemini" connection → "gemini"', () => {
    config.connections = [
      {
        ...baseConn,
        protocol: 'gemini',
        endpoint: 'https://generativelanguage.googleapis.com',
        models: [{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }],
      },
    ]
    expect(getProviderForModel('test:gemini-2.5-pro')).toBe('gemini')
  })

  test('protocol="codex" connection → "codex"', () => {
    config.connections = [
      {
        ...baseConn,
        protocol: 'codex',
        endpoint: 'https://chatgpt.com/backend-api',
        models: [{ id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' }],
      },
    ]
    expect(getProviderForModel('test:gpt-5.2-codex')).toBe('codex')
  })

  test('never returns the literal string "anthropic" (the leak)', () => {
    // Regression guard for v26.5.25's `as APIProvider` cast bug — every
    // possible connection.protocol must produce a valid APIProvider value.
    const protocols = ['anthropic', 'openai', 'gemini', 'codex'] as const
    for (const protocol of protocols) {
      config.connections = [
        { ...baseConn, protocol, endpoint: 'https://example.com' },
      ]
      expect(getProviderForModel('test:claude-opus-4-7')).not.toBe('anthropic')
    }
  })
})

describe('isFirstPartyAnthropicEndpoint', () => {
  test('no model id, no connection, no env override → uses ANTHROPIC_BASE_URL default (true)', () => {
    expect(isFirstPartyAnthropicEndpoint()).toBe(true)
  })

  test('no model id, ANTHROPIC_BASE_URL set to proxy → false', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://my-proxy.example.com'
    expect(isFirstPartyAnthropicEndpoint()).toBe(false)
  })

  test('no model id, CLAUDE_CODE_USE_BEDROCK=1 → false (bedrock is not "firstParty endpoint" even if Anthropic-class)', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(isFirstPartyAnthropicEndpoint()).toBe(false)
  })

  test('model resolves to anthropic connection on api.anthropic.com → true', () => {
    config.connections = [
      { ...baseConn, protocol: 'anthropic', endpoint: 'https://api.anthropic.com' },
    ]
    expect(isFirstPartyAnthropicEndpoint('test:claude-opus-4-7')).toBe(true)
  })

  test('model resolves to anthropic connection on a proxy endpoint → false (the FGTS bug fix)', () => {
    config.connections = [
      {
        ...baseConn,
        protocol: 'anthropic',
        endpoint: 'https://my-litellm.example.com/anthropic',
      },
    ]
    expect(isFirstPartyAnthropicEndpoint('test:claude-opus-4-7')).toBe(false)
  })

  test('model resolves to openai connection → false (not an Anthropic endpoint at all)', () => {
    config.connections = [
      {
        ...baseConn,
        protocol: 'openai',
        endpoint: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
      },
    ]
    expect(isFirstPartyAnthropicEndpoint('test:gpt-5.5')).toBe(false)
  })

  test('model id with no matching connection → falls back to env-only check', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://my-proxy.example.com'
    expect(isFirstPartyAnthropicEndpoint('claude-opus-4-7')).toBe(false)
  })
})
