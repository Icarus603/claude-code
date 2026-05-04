import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resolveGeminiModel } from '../gemini/modelMapping.js'

// Use real env via process.env. The previous mock.module on
// @claude-code/config/env was process-wide pollution in bun-test (env
// module re-exports utils, so mocking it broke readEnv globally). See
// feedback_self_audit_before_declaring_done.md.
const TRACKED = [
  'GEMINI_MODEL',
  'GEMINI_DEFAULT_HAIKU_MODEL',
  'GEMINI_DEFAULT_SONNET_MODEL',
  'GEMINI_DEFAULT_OPUS_MODEL',
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

describe('resolveGeminiModel — explicit GEMINI_MODEL override', () => {
  test('GEMINI_MODEL takes precedence over family-based resolution', () => {
    process.env.GEMINI_MODEL = 'gemini-2.0-pro-experimental'
    expect(resolveGeminiModel('claude-haiku-4-5')).toBe(
      'gemini-2.0-pro-experimental',
    )
  })

  test('GEMINI_MODEL takes precedence even when GEMINI_DEFAULT_* is set', () => {
    process.env.GEMINI_MODEL = 'override'
    process.env.GEMINI_DEFAULT_HAIKU_MODEL = 'gemini-flash'
    expect(resolveGeminiModel('claude-haiku-4-5')).toBe('override')
  })
})

describe('resolveGeminiModel — family detection', () => {
  test('haiku family → GEMINI_DEFAULT_HAIKU_MODEL', () => {
    process.env.GEMINI_DEFAULT_HAIKU_MODEL = 'gemini-flash'
    expect(resolveGeminiModel('claude-haiku-4-5')).toBe('gemini-flash')
  })

  test('sonnet family → GEMINI_DEFAULT_SONNET_MODEL', () => {
    process.env.GEMINI_DEFAULT_SONNET_MODEL = 'gemini-pro'
    expect(resolveGeminiModel('claude-sonnet-4-5')).toBe('gemini-pro')
  })

  test('opus family → GEMINI_DEFAULT_OPUS_MODEL', () => {
    process.env.GEMINI_DEFAULT_OPUS_MODEL = 'gemini-ultra'
    expect(resolveGeminiModel('claude-opus-4-7')).toBe('gemini-ultra')
  })

  test('family detection is case-insensitive', () => {
    process.env.GEMINI_DEFAULT_HAIKU_MODEL = 'gemini-flash'
    expect(resolveGeminiModel('CLAUDE-HAIKU-4-5')).toBe('gemini-flash')
    expect(resolveGeminiModel('Claude-Haiku-4-5')).toBe('gemini-flash')
  })

  test('strips [1m] suffix before family detection', () => {
    process.env.GEMINI_DEFAULT_SONNET_MODEL = 'gemini-pro'
    expect(resolveGeminiModel('claude-sonnet-4-5[1m]')).toBe('gemini-pro')
  })

  test('strips [1m] case-insensitively', () => {
    process.env.GEMINI_DEFAULT_OPUS_MODEL = 'gemini-ultra'
    expect(resolveGeminiModel('claude-opus-4-7[1M]')).toBe('gemini-ultra')
  })
})

describe('resolveGeminiModel — backward-compat ANTHROPIC_DEFAULT_*', () => {
  test('falls back to ANTHROPIC_DEFAULT_HAIKU_MODEL when GEMINI_DEFAULT_HAIKU_MODEL is unset', () => {
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'compat-haiku'
    expect(resolveGeminiModel('claude-haiku-4-5')).toBe('compat-haiku')
  })

  test('GEMINI_DEFAULT_* takes precedence over ANTHROPIC_DEFAULT_*', () => {
    process.env.GEMINI_DEFAULT_SONNET_MODEL = 'gemini-pro'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'anthropic-fallback'
    expect(resolveGeminiModel('claude-sonnet-4-5')).toBe('gemini-pro')
  })
})

describe('resolveGeminiModel — non-family-detectable models', () => {
  test('passes through unchanged when no family is detectable', () => {
    expect(resolveGeminiModel('custom-model-name-123')).toBe(
      'custom-model-name-123',
    )
  })

  test('strips [1m] even from passthrough models', () => {
    // Wait — actually, the cleanModel.replace happens BEFORE family
    // detection but after the unidentifiable case the function
    // returns cleanModel (post-strip). Verify [1m] is removed.
    expect(resolveGeminiModel('weird-model[1m]')).toBe('weird-model')
  })
})

describe('resolveGeminiModel — error case', () => {
  test('throws ConfigurationError when family is detectable but no env var is set', () => {
    expect(() => resolveGeminiModel('claude-haiku-4-5')).toThrow(
      /GEMINI_MODEL or GEMINI_DEFAULT_HAIKU_MODEL/i,
    )
  })

  test('error message references the correct family', () => {
    try {
      resolveGeminiModel('claude-opus-4-7')
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toContain('OPUS')
    }
  })

  test('error message lists the backward-compat var as a fallback', () => {
    try {
      resolveGeminiModel('claude-sonnet-4-5')
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toContain('ANTHROPIC_DEFAULT_SONNET_MODEL')
    }
  })
})
