import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ConnectionRecord } from '@claude-code/config'

/**
 * Native Anthropic endpoint vs anthropic-protocol proxy: the asymmetry that
 * lives at the bottom of `modelSupportsMaxEffort` / `modelSupportsXhighEffort`.
 *
 * Background — DeepSeek's official Claude Code recipe sets
 *   ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
 *   ANTHROPIC_MODEL=deepseek-v4-pro[1m]
 *   CLAUDE_CODE_EFFORT_LEVEL=max
 * which lands as a pure env-only `firstParty` setup with no connection
 * record. The Anthropic capability matrix (max ⇒ Opus 4.7/4.6/Sonnet 4.6)
 * is wrong for this endpoint — it's DeepSeek's enum, not Anthropic's. The
 * fix at the bottom of these two functions defaults to TRUE for
 * anthropic-protocol proxies (firstParty AND not native api.anthropic.com),
 * mirroring the same shape `modelSupportsEffort` already had.
 *
 * Regression guard against re-introducing the silent `max → high` clamp.
 */

const realConfigModule = await import('@claude-code/config')
const config = {
  connections: [] as ConnectionRecord[],
}

mock.module('@claude-code/config', () => ({
  ...realConfigModule,
  getGlobalConfig: () => config,
}))

const realSettingsModule = await import('@claude-code/config/settings')
mock.module('@claude-code/config/settings', () => ({
  ...realSettingsModule,
  getInitialSettings: () => ({}),
}))

const { modelSupportsMaxEffort, modelSupportsXhighEffort, resolveAppliedEffort } =
  await import('../effort.js')

const TRACKED_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'CLAUDE_CODE_ALWAYS_ENABLE_EFFORT',
  'USER_TYPE',
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

describe('modelSupportsMaxEffort — native vs anthropic-protocol proxy', () => {
  test('native api.anthropic.com + Opus 4.7 → true (capability matrix)', () => {
    expect(modelSupportsMaxEffort('claude-opus-4-7-20250101')).toBe(true)
  })

  test('native api.anthropic.com + unknown model → false (Anthropic matrix is authoritative)', () => {
    expect(modelSupportsMaxEffort('claude-haiku-4-5')).toBe(false)
  })

  test('DeepSeek anthropic-protocol proxy (env-only) + their wire model → true', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic'
    expect(modelSupportsMaxEffort('deepseek-v4-pro[1m]')).toBe(true)
  })

  test('LiteLLM-style anthropic-protocol proxy (env-only) + arbitrary model → true', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://my-litellm.example.com/anthropic'
    expect(modelSupportsMaxEffort('whatever-model')).toBe(true)
  })

  test('Bedrock deployment + unknown model → false (not anthropic-protocol-proxy fallthrough)', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(modelSupportsMaxEffort('claude-haiku-4-5')).toBe(false)
  })
})

describe('modelSupportsXhighEffort — narrower than max', () => {
  test('native api.anthropic.com + Opus 4.7 → true', () => {
    expect(modelSupportsXhighEffort('claude-opus-4-7-20250101')).toBe(true)
  })

  test('native api.anthropic.com + Sonnet 4.6 → false (xhigh is Opus 4.7-only on Anthropic)', () => {
    expect(modelSupportsXhighEffort('claude-sonnet-4-6')).toBe(false)
  })

  test('DeepSeek anthropic-protocol proxy → false (NO documented xhigh support)', () => {
    // Asymmetry with `modelSupportsMaxEffort`: 'max' is user-facing on
    // DeepSeek per their own docs, 'xhigh' is an Anthropic-internal tier
    // with no known proxy support. Don't default-trust unless a connection
    // record explicitly opts in via supportedEfforts.
    process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic'
    expect(modelSupportsXhighEffort('deepseek-v4-pro[1m]')).toBe(false)
  })
})

describe('resolveAppliedEffort — DeepSeek max passthrough end-to-end', () => {
  test('CLAUDE_CODE_EFFORT_LEVEL=max + DeepSeek base URL → max (no silent clamp to high)', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic'
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'max'
    expect(resolveAppliedEffort('deepseek-v4-pro[1m]', undefined)).toBe('max')
  })

  test('CLAUDE_CODE_EFFORT_LEVEL=max + native Anthropic + Haiku → high (clamped, expected)', () => {
    // Stays clamped on native because Anthropic's matrix is authoritative
    // and Haiku doesn't accept 'max'. This is the cross-model migration
    // protection the clamp exists for in the first place.
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'max'
    expect(resolveAppliedEffort('claude-haiku-4-5', undefined)).toBe('high')
  })
})
