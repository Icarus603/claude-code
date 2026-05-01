import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ConnectionRecord } from '@claude-code/config'

const realConfigModule = await import('@claude-code/config')
const realEnvUtilsModule = await import('@claude-code/config/env/utils')
const config = {
  connections: [] as ConnectionRecord[],
}
const envMap = new Map<string, string>()

mock.module('@claude-code/config', () => ({
  ...realConfigModule,
  getGlobalConfig: () => config,
}))

mock.module('@claude-code/config/env/utils', () => ({
  ...realEnvUtilsModule,
  readEnv: (key: string) => envMap.get(key) ?? '',
}))

const {
  modelSupportsAdaptiveThinking,
  modelSupportsThinking,
  shouldRequireThinkingSignatureForModel,
} = await import('../thinking.js')

beforeEach(() => {
  config.connections = []
  envMap.clear()
  delete process.env.USER_TYPE
})

describe('connection-aware thinking support', () => {
  test('does not enable Anthropic thinking for compatible non-Anthropic endpoints', () => {
    config.connections = [
      {
        id: 'deepseek-anthropic',
        name: 'DeepSeek Anthropic Compatible',
        protocol: 'anthropic',
        endpoint: 'https://api.deepseek.com/anthropic',
        auth: { type: 'api_key', key: 'test' },
        enabled: true,
        models: [
          {
            id: 'claude-opus-4-7',
            label: 'Opus (claude-opus-4-7)',
          },
        ],
        createdAt: 0,
      },
    ]

    const model = 'deepseek-anthropic:claude-opus-4-7'

    expect(modelSupportsThinking(model)).toBe(false)
    expect(modelSupportsAdaptiveThinking(model)).toBe(false)
    expect(shouldRequireThinkingSignatureForModel(model)).toBe(false)
  })

  test('honors explicit capability overrides for compatible endpoints', () => {
    config.connections = [
      {
        id: 'deepseek-anthropic-override',
        name: 'DeepSeek Anthropic Compatible',
        protocol: 'anthropic',
        endpoint: 'https://api.deepseek.com/anthropic',
        auth: { type: 'api_key', key: 'test' },
        enabled: true,
        models: [
          {
            id: 'deepseek-reasoner',
            label: 'DeepSeek Reasoner',
          },
        ],
        createdAt: 0,
      },
    ]
    envMap.set('ANTHROPIC_DEFAULT_OPUS_MODEL', 'deepseek-reasoner')
    envMap.set(
      'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
      'thinking,adaptive_thinking',
    )

    const model = 'deepseek-anthropic-override:deepseek-reasoner'

    expect(modelSupportsThinking(model)).toBe(true)
    expect(modelSupportsAdaptiveThinking(model)).toBe(true)
    expect(shouldRequireThinkingSignatureForModel(model)).toBe(false)
  })

  test('does not require signatures for env-only compatible base URLs', () => {
    envMap.set('ANTHROPIC_BASE_URL', 'https://api.deepseek.com/anthropic')

    expect(shouldRequireThinkingSignatureForModel('deepseek-v4-pro[1m]')).toBe(
      false,
    )
  })

  test('keeps Anthropic thinking defaults for official Anthropic endpoints', () => {
    config.connections = [
      {
        id: 'anthropic-console',
        name: 'Anthropic Console',
        protocol: 'anthropic',
        endpoint: 'https://api.anthropic.com',
        auth: { type: 'api_key', key: 'test' },
        enabled: true,
        models: [
          {
            id: 'claude-opus-4-7',
            label: 'Opus 4.7',
          },
        ],
        createdAt: 0,
      },
    ]

    const model = 'anthropic-console:claude-opus-4-7'

    expect(modelSupportsThinking(model)).toBe(true)
    expect(modelSupportsAdaptiveThinking(model)).toBe(true)
    expect(shouldRequireThinkingSignatureForModel(model)).toBe(true)
  })
})
