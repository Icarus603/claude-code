import { beforeEach, describe, expect, mock, test } from 'bun:test'

const realEnvModule = await import('@claude-code/config/env')
const envMap = new Map<string, string>()
mock.module('@claude-code/config/env', () => ({
  ...realEnvModule,
  readEnv: (key: string) => envMap.get(key) ?? '',
}))

const { resolveGrokModel } = await import('../grok/modelMapping.js')

beforeEach(() => {
  envMap.clear()
})

describe('resolveGrokModel — GROK_MODEL global override', () => {
  test('GROK_MODEL takes precedence over everything', () => {
    envMap.set('GROK_MODEL', 'grok-experimental')
    envMap.set('GROK_MODEL_MAP', '{"opus":"json-grok"}')
    envMap.set('GROK_DEFAULT_OPUS_MODEL', 'env-grok')
    expect(resolveGrokModel('claude-opus-4-7')).toBe('grok-experimental')
  })
})

describe('resolveGrokModel — GROK_MODEL_MAP JSON', () => {
  test('parses JSON family map and uses it for opus', () => {
    envMap.set(
      'GROK_MODEL_MAP',
      '{"opus":"grok-4-pro","sonnet":"grok-3","haiku":"grok-3-mini-fast"}',
    )
    expect(resolveGrokModel('claude-opus-4-7')).toBe('grok-4-pro')
  })

  test('parses JSON family map and uses it for sonnet', () => {
    envMap.set(
      'GROK_MODEL_MAP',
      '{"opus":"grok-4-pro","sonnet":"grok-3","haiku":"grok-3-mini-fast"}',
    )
    expect(resolveGrokModel('claude-sonnet-4-6')).toBe('grok-3')
  })

  test('JSON map wins over GROK_DEFAULT_<FAMILY>_MODEL env var', () => {
    envMap.set('GROK_MODEL_MAP', '{"sonnet":"json-grok"}')
    envMap.set('GROK_DEFAULT_SONNET_MODEL', 'env-grok')
    expect(resolveGrokModel('claude-sonnet-4-6')).toBe('json-grok')
  })

  test('falls through to next tier when JSON map lacks the family key', () => {
    envMap.set('GROK_MODEL_MAP', '{"opus":"only-opus-mapped"}')
    envMap.set('GROK_DEFAULT_HAIKU_MODEL', 'env-haiku')
    expect(resolveGrokModel('claude-haiku-4-5')).toBe('env-haiku')
  })

  test('invalid JSON in GROK_MODEL_MAP is ignored (falls through)', () => {
    envMap.set('GROK_MODEL_MAP', 'not-valid-json')
    envMap.set('GROK_DEFAULT_OPUS_MODEL', 'env-opus')
    expect(resolveGrokModel('claude-opus-4-7')).toBe('env-opus')
  })

  test('GROK_MODEL_MAP that is a JSON array (not object) is ignored', () => {
    // Contract: must be a plain object. Arrays / strings / nulls fall through.
    envMap.set('GROK_MODEL_MAP', '["grok-4"]')
    envMap.set('GROK_DEFAULT_OPUS_MODEL', 'fallback-grok')
    expect(resolveGrokModel('claude-opus-4-7')).toBe('fallback-grok')
  })

  test('GROK_MODEL_MAP that is a JSON null is ignored', () => {
    envMap.set('GROK_MODEL_MAP', 'null')
    envMap.set('GROK_DEFAULT_OPUS_MODEL', 'fallback-grok')
    expect(resolveGrokModel('claude-opus-4-7')).toBe('fallback-grok')
  })
})

describe('resolveGrokModel — GROK_DEFAULT_<FAMILY>_MODEL', () => {
  test('used when GROK_MODEL_MAP is unset', () => {
    envMap.set('GROK_DEFAULT_HAIKU_MODEL', 'grok-haiku-custom')
    expect(resolveGrokModel('claude-haiku-4-5')).toBe('grok-haiku-custom')
  })

  test('takes precedence over ANTHROPIC_DEFAULT_<FAMILY>_MODEL', () => {
    envMap.set('GROK_DEFAULT_SONNET_MODEL', 'grok-pref')
    envMap.set('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic-fallback')
    expect(resolveGrokModel('claude-sonnet-4-6')).toBe('grok-pref')
  })
})

describe('resolveGrokModel — ANTHROPIC_DEFAULT_<FAMILY>_MODEL backward compat', () => {
  test('used when neither GROK env vars are set', () => {
    envMap.set('ANTHROPIC_DEFAULT_OPUS_MODEL', 'compat-opus')
    expect(resolveGrokModel('claude-opus-4-7')).toBe('compat-opus')
  })
})

describe('resolveGrokModel — DEFAULT_MODEL_MAP', () => {
  test('claude-opus-4-7 → grok-4.20-reasoning', () => {
    expect(resolveGrokModel('claude-opus-4-7')).toBe('grok-4.20-reasoning')
  })

  test('claude-sonnet-4-6 → grok-3-mini-fast', () => {
    expect(resolveGrokModel('claude-sonnet-4-6')).toBe('grok-3-mini-fast')
  })

  test('claude-haiku-4-5-20251001 → grok-3-mini-fast', () => {
    expect(resolveGrokModel('claude-haiku-4-5-20251001')).toBe(
      'grok-3-mini-fast',
    )
  })
})

describe('resolveGrokModel — DEFAULT_FAMILY_MAP fallback', () => {
  test('unknown opus model falls back to family default', () => {
    expect(resolveGrokModel('claude-opus-future-version')).toBe(
      'grok-4.20-reasoning',
    )
  })

  test('unknown sonnet model falls back to family default', () => {
    expect(resolveGrokModel('claude-sonnet-future-version')).toBe(
      'grok-3-mini-fast',
    )
  })
})

describe('resolveGrokModel — passthrough', () => {
  test('returns input unchanged when family unknown + no env + not in map', () => {
    expect(resolveGrokModel('totally-custom-llm')).toBe('totally-custom-llm')
  })
})

describe('resolveGrokModel — [1m] suffix', () => {
  test('strips [1m] before resolution', () => {
    expect(resolveGrokModel('claude-opus-4-7[1m]')).toBe('grok-4.20-reasoning')
  })
})

describe('resolveGrokModel — case insensitivity', () => {
  test('uppercase model triggers family detection', () => {
    expect(resolveGrokModel('CLAUDE-OPUS-4-7')).toBe('grok-4.20-reasoning')
  })
})
