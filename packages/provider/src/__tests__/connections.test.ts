import { describe, expect, test } from 'bun:test'
import type { ConnectionRecord } from '@claude-code/config'
import {
  CLAUDE_AI_CONNECTION_ID,
  CODEX_CONNECTION_ID,
  CONSOLE_CONNECTION_ID,
  composeModelId,
  generateConnectionId,
  getDefaultModelsForProtocol,
  isFirstPartyAnthropicConnection,
  isWellKnownConnection,
  prettyModelLabel,
  unpackModelId,
} from '../connections.js'

describe('composeModelId', () => {
  test('appends :modelId when connectionId provided', () => {
    expect(composeModelId('claude-account', 'claude-opus-4-7')).toBe(
      'claude-account:claude-opus-4-7',
    )
  })
  test('returns bare modelId when connectionId undefined (legacy path)', () => {
    expect(composeModelId(undefined, 'gpt-5.5')).toBe('gpt-5.5')
  })
  test('preserves model paths with slashes', () => {
    expect(composeModelId('conn_abc12345', 'models/gemini-2.5-pro')).toBe(
      'conn_abc12345:models/gemini-2.5-pro',
    )
  })
})

describe('unpackModelId', () => {
  test('splits on first :', () => {
    expect(unpackModelId('claude-account:claude-opus-4-7')).toEqual({
      connectionId: 'claude-account',
      modelId: 'claude-opus-4-7',
    })
  })
  test('returns bare modelId when no separator', () => {
    expect(unpackModelId('claude-opus-4-7')).toEqual({
      connectionId: undefined,
      modelId: 'claude-opus-4-7',
    })
  })
  test('rejects head with slash (model paths like models/gemini-2.5-pro)', () => {
    // `models/gemini-2.5-pro` shouldn't be misparsed as connection=models
    expect(unpackModelId('models/gemini-2.5-pro:foo')).toEqual({
      connectionId: undefined,
      modelId: 'models/gemini-2.5-pro:foo',
    })
  })
  test('rejects head with dot (also a path indicator)', () => {
    expect(unpackModelId('gpt-4.5:turbo')).toEqual({
      connectionId: undefined,
      modelId: 'gpt-4.5:turbo',
    })
  })
  test('handles empty modelId after separator', () => {
    expect(unpackModelId('claude-account:')).toEqual({
      connectionId: 'claude-account',
      modelId: '',
    })
  })
  test('round-trip: unpack(compose(c, m)) returns inputs', () => {
    const composed = composeModelId('conn_abc12345', 'opus')
    expect(unpackModelId(composed)).toEqual({
      connectionId: 'conn_abc12345',
      modelId: 'opus',
    })
  })
  test('idx=0 (leading colon) → no connectionId', () => {
    expect(unpackModelId(':lonely')).toEqual({
      connectionId: undefined,
      modelId: ':lonely',
    })
  })
})

describe('generateConnectionId', () => {
  test('starts with conn_ prefix', () => {
    expect(generateConnectionId().startsWith('conn_')).toBe(true)
  })
  test('total length is 13 (conn_ + 8 chars)', () => {
    expect(generateConnectionId().length).toBe(13)
  })
  test('uses lowercase alphanumeric only', () => {
    const id = generateConnectionId().slice('conn_'.length)
    expect(/^[a-z0-9]{8}$/.test(id)).toBe(true)
  })
  test('produces unique ids across many calls (entropy sanity)', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 200; i++) ids.add(generateConnectionId())
    // Birthday-paradox math says collisions across 200 in 36^8 (~2.8T) are
    // negligible. If even one duplicates, something is wrong with Math.random.
    expect(ids.size).toBe(200)
  })
})

describe('isWellKnownConnection', () => {
  test('claude-account is well-known', () => {
    expect(isWellKnownConnection(CLAUDE_AI_CONNECTION_ID)).toBe(true)
  })
  test('anthropic-console is well-known', () => {
    expect(isWellKnownConnection(CONSOLE_CONNECTION_ID)).toBe(true)
  })
  test('chatgpt-codex is well-known', () => {
    expect(isWellKnownConnection(CODEX_CONNECTION_ID)).toBe(true)
  })
  test('user-generated conn_ ids are NOT well-known', () => {
    expect(isWellKnownConnection('conn_abc12345')).toBe(false)
  })
  test('unknown ids are not well-known', () => {
    expect(isWellKnownConnection('something-else')).toBe(false)
  })
})

describe('prettyModelLabel', () => {
  test('strips alias when label matches "Alias (wire-id)"', () => {
    expect(
      prettyModelLabel({
        id: 'deepseek-v4-pro',
        label: 'Opus (deepseek-v4-pro)',
        description: '',
      }),
    ).toBe('deepseek-v4-pro')
  })
  test('passes native labels through unchanged (no parens)', () => {
    expect(
      prettyModelLabel({ id: 'opus', label: 'Opus 4.7', description: '' }),
    ).toBe('Opus 4.7')
  })
  test('preserves label when wire-id in parens does NOT match the model id', () => {
    // "Opus (something-else)" — paren content doesn't match id, so the
    // pattern is decorative, not the migration-style alias prefix.
    expect(
      prettyModelLabel({
        id: 'opus',
        label: 'Opus (custom)',
        description: '',
      }),
    ).toBe('Opus (custom)')
  })
  test('handles whitespace in label', () => {
    expect(
      prettyModelLabel({
        id: 'gpt-5.5',
        label: '  GPT (gpt-5.5)  ',
        description: '',
      }),
    ).toBe('gpt-5.5')
  })
})

describe('getDefaultModelsForProtocol', () => {
  test('anthropic returns Opus/Sonnet/Haiku', () => {
    const models = getDefaultModelsForProtocol('anthropic')
    expect(models.map(m => m.id)).toContain('claude-opus-4-7')
    expect(models.map(m => m.id)).toContain('claude-sonnet-4-6')
    expect(models.map(m => m.id)).toContain('claude-haiku-4-5')
  })
  test('codex returns the static GPT 5.x mirror list', () => {
    const models = getDefaultModelsForProtocol('codex')
    expect(models.length).toBeGreaterThanOrEqual(3)
    expect(models[0]!.id.startsWith('gpt-')).toBe(true)
    // Codex models all carry effort metadata
    for (const m of models) {
      expect(m.supportedEfforts).toBeDefined()
      expect(m.defaultEffort).toBeDefined()
    }
  })
  test('openai returns gpt-4o pair', () => {
    const ids = getDefaultModelsForProtocol('openai').map(m => m.id)
    expect(ids).toContain('gpt-4o')
    expect(ids).toContain('gpt-4o-mini')
  })
  test('gemini returns 2.5 pro/flash', () => {
    const ids = getDefaultModelsForProtocol('gemini').map(m => m.id)
    expect(ids).toContain('gemini-2.5-pro')
    expect(ids).toContain('gemini-2.5-flash')
  })
})

describe('isFirstPartyAnthropicConnection', () => {
  const baseConn = {
    id: 'x',
    name: 'X',
    auth: { type: 'api_key' as const, key: 'k' },
    enabled: true,
    models: [],
    createdAt: 0,
  }

  test('returns false for undefined', () => {
    expect(isFirstPartyAnthropicConnection(undefined)).toBe(false)
  })

  test('returns false for non-anthropic protocol', () => {
    const conn: ConnectionRecord = {
      ...baseConn,
      protocol: 'openai',
      endpoint: 'https://api.anthropic.com',
    }
    expect(isFirstPartyAnthropicConnection(conn)).toBe(false)
  })

  test('returns true for api.anthropic.com', () => {
    const conn: ConnectionRecord = {
      ...baseConn,
      protocol: 'anthropic',
      endpoint: 'https://api.anthropic.com',
    }
    expect(isFirstPartyAnthropicConnection(conn)).toBe(true)
  })

  test('returns true for api.anthropic.com with path', () => {
    const conn: ConnectionRecord = {
      ...baseConn,
      protocol: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1',
    }
    expect(isFirstPartyAnthropicConnection(conn)).toBe(true)
  })

  test('returns true for api-staging.anthropic.com', () => {
    const conn: ConnectionRecord = {
      ...baseConn,
      protocol: 'anthropic',
      endpoint: 'https://api-staging.anthropic.com',
    }
    expect(isFirstPartyAnthropicConnection(conn)).toBe(true)
  })

  test('returns false for self-hosted proxy', () => {
    const conn: ConnectionRecord = {
      ...baseConn,
      protocol: 'anthropic',
      endpoint: 'https://my-litellm.example.com/anthropic',
    }
    expect(isFirstPartyAnthropicConnection(conn)).toBe(false)
  })

  test('returns false for malformed endpoint', () => {
    const conn: ConnectionRecord = {
      ...baseConn,
      protocol: 'anthropic',
      endpoint: 'not a url',
    }
    expect(isFirstPartyAnthropicConnection(conn)).toBe(false)
  })
})
