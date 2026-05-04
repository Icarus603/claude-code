import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resolveOpenAIModel } from '../openai/modelMapping.js'

// Use real env via process.env. The previous mock.module on
// @claude-code/config/env was process-wide pollution in bun-test (the env
// module re-exports utils so mocking it broke readEnv globally). See
// feedback_self_audit_before_declaring_done.md.
const TRACKED = [
  'OPENAI_MODEL',
  'OPENAI_DEFAULT_HAIKU_MODEL',
  'OPENAI_DEFAULT_SONNET_MODEL',
  'OPENAI_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
] as const
const saved = new Map<string, string | undefined>()

beforeEach(() => {
  for (const k of TRACKED) {
    saved.set(k, process.env[k])
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of TRACKED) {
    const v = saved.get(k)
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  saved.clear()
})

describe('resolveOpenAIModel — explicit OPENAI_MODEL override', () => {
  test('OPENAI_MODEL takes precedence over family resolution', () => {
    process.env.OPENAI_MODEL = 'gpt-5-experimental'
    expect(resolveOpenAIModel('claude-haiku-4-5')).toBe('gpt-5-experimental')
  })

  test('OPENAI_MODEL takes precedence over OPENAI_DEFAULT_HAIKU_MODEL', () => {
    process.env.OPENAI_MODEL = 'override'
    process.env.OPENAI_DEFAULT_HAIKU_MODEL = 'gpt-4o-mini'
    expect(resolveOpenAIModel('claude-haiku-4-5')).toBe('override')
  })

  test('OPENAI_MODEL takes precedence over DEFAULT_MODEL_MAP lookups', () => {
    process.env.OPENAI_MODEL = 'override'
    expect(resolveOpenAIModel('claude-opus-4-7')).toBe('override')
  })
})

describe('resolveOpenAIModel — OPENAI_DEFAULT_<FAMILY>_MODEL', () => {
  test('haiku family → OPENAI_DEFAULT_HAIKU_MODEL when set', () => {
    process.env.OPENAI_DEFAULT_HAIKU_MODEL = 'gpt-4o-mini-custom'
    expect(resolveOpenAIModel('claude-haiku-4-5')).toBe('gpt-4o-mini-custom')
  })

  test('sonnet family → OPENAI_DEFAULT_SONNET_MODEL when set', () => {
    process.env.OPENAI_DEFAULT_SONNET_MODEL = 'gpt-4o-custom'
    expect(resolveOpenAIModel('claude-sonnet-4-6')).toBe('gpt-4o-custom')
  })

  test('opus family → OPENAI_DEFAULT_OPUS_MODEL when set', () => {
    process.env.OPENAI_DEFAULT_OPUS_MODEL = 'o3-pro-custom'
    expect(resolveOpenAIModel('claude-opus-4-7')).toBe('o3-pro-custom')
  })
})

describe('resolveOpenAIModel — ANTHROPIC_DEFAULT_<FAMILY>_MODEL backward compat', () => {
  test('falls back to ANTHROPIC_DEFAULT_HAIKU_MODEL when OPENAI_DEFAULT_HAIKU_MODEL unset', () => {
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'compat-haiku'
    expect(resolveOpenAIModel('claude-haiku-4-5')).toBe('compat-haiku')
  })

  test('OPENAI_DEFAULT_<FAMILY>_MODEL takes precedence over ANTHROPIC_DEFAULT_<FAMILY>_MODEL', () => {
    process.env.OPENAI_DEFAULT_SONNET_MODEL = 'gpt-4o'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'fallback-sonnet'
    expect(resolveOpenAIModel('claude-sonnet-4-6')).toBe('gpt-4o')
  })
})

describe('resolveOpenAIModel — DEFAULT_MODEL_MAP', () => {
  test('claude-sonnet-4-6 → gpt-4o (no env vars)', () => {
    expect(resolveOpenAIModel('claude-sonnet-4-6')).toBe('gpt-4o')
  })

  test('claude-opus-4-7 → o3 (no env vars)', () => {
    expect(resolveOpenAIModel('claude-opus-4-7')).toBe('o3')
  })

  test('claude-haiku-4-5-20251001 → gpt-4o-mini', () => {
    expect(resolveOpenAIModel('claude-haiku-4-5-20251001')).toBe('gpt-4o-mini')
  })

  test('claude-3-5-sonnet-20241022 → gpt-4o (legacy alias)', () => {
    expect(resolveOpenAIModel('claude-3-5-sonnet-20241022')).toBe('gpt-4o')
  })

  test('claude-3-5-haiku-20241022 → gpt-4o-mini (legacy alias)', () => {
    expect(resolveOpenAIModel('claude-3-5-haiku-20241022')).toBe('gpt-4o-mini')
  })

  test('claude-opus-4-5-20251101 → o3 (specific opus version)', () => {
    expect(resolveOpenAIModel('claude-opus-4-5-20251101')).toBe('o3')
  })
})

describe('resolveOpenAIModel — [1m] suffix stripping', () => {
  test('strips [1m] before family detection', () => {
    process.env.OPENAI_DEFAULT_SONNET_MODEL = 'gpt-4o-1m'
    expect(resolveOpenAIModel('claude-sonnet-4-6[1m]')).toBe('gpt-4o-1m')
  })

  test('strips [1m] before DEFAULT_MODEL_MAP lookup', () => {
    expect(resolveOpenAIModel('claude-sonnet-4-6[1m]')).toBe('gpt-4o')
  })

  test('returns cleanModel (post-strip) when nothing else matches', () => {
    expect(resolveOpenAIModel('unknown-model[1m]')).toBe('unknown-model')
  })
})

describe('resolveOpenAIModel — passthrough', () => {
  test('returns input unchanged when no family + no env var + not in DEFAULT_MODEL_MAP', () => {
    expect(resolveOpenAIModel('custom-llm-v1')).toBe('custom-llm-v1')
  })

  test('returns input when family detection fails (unrecognized model)', () => {
    expect(resolveOpenAIModel('totally-unknown-model')).toBe(
      'totally-unknown-model',
    )
  })
})

describe('resolveOpenAIModel — case insensitivity in family detection', () => {
  test('uppercase family names trigger detection', () => {
    process.env.OPENAI_DEFAULT_OPUS_MODEL = 'override'
    expect(resolveOpenAIModel('CLAUDE-OPUS-4-7')).toBe('override')
  })
})
