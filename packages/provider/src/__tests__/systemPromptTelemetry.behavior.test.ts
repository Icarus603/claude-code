import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  __resetSystemPromptDedupForTest,
  maybeEmitSystemPromptEvent,
} from '../systemPromptTelemetry.ts'
import { __resetOTelEventStateForTest } from '@claude-code/local-observability/telemetry'
import {
  getEventLogger,
  setEventLogger,
} from '@claude-code/app-host/bootstrap/state.js'

/**
 * Pin port of ant D_7 (2911.js) — system_prompt OTel event with
 * per-process dedup. The dedup key matters: a chatty system-prompt
 * stream would bury other events; once-per-hash matches ant exactly
 * so customer dashboards see expected volume.
 */

type EmittedLog = {
  timestamp: Date
  observedTimestamp: Date
  body: string
  attributes: Record<string, unknown>
}

function makeFakeLogger(): {
  emitted: EmittedLog[]
  emit: (l: EmittedLog) => void
} {
  const emitted: EmittedLog[] = []
  return { emitted, emit: l => emitted.push(l) }
}

const originalLogger = getEventLogger()

beforeEach(() => {
  __resetOTelEventStateForTest()
  __resetSystemPromptDedupForTest()
})

afterEach(() => {
  setEventLogger(originalLogger as never)
})

describe('maybeEmitSystemPromptEvent', () => {
  test('empty content → no-op, returns null', () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    expect(maybeEmitSystemPromptEvent(undefined)).toBeNull()
    expect(maybeEmitSystemPromptEvent('')).toBeNull()
    expect(fake.emitted.length).toBe(0)
  })

  test('first call emits + returns sp_-prefixed hash', () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    const h = maybeEmitSystemPromptEvent('You are Claude.')
    expect(h).toMatch(/^sp_[0-9a-f]{12}$/)
    expect(fake.emitted.length).toBe(1)
    expect(fake.emitted[0]!.body).toBe('claude_code.system_prompt')
    expect(fake.emitted[0]!.attributes['system_prompt_hash']).toBe(h)
    expect(fake.emitted[0]!.attributes['system_prompt_length']).toBe('15')
  })

  test('dedup: second call with same content does NOT re-emit', () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    maybeEmitSystemPromptEvent('hello')
    maybeEmitSystemPromptEvent('hello')
    maybeEmitSystemPromptEvent('hello')
    expect(fake.emitted.length).toBe(1)
  })

  test('different content → separate emissions', () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    maybeEmitSystemPromptEvent('one')
    maybeEmitSystemPromptEvent('two')
    expect(fake.emitted.length).toBe(2)
  })

  test('returns the hash even on dedup-hit (caller may stamp on span)', () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    const h1 = maybeEmitSystemPromptEvent('hello')
    const h2 = maybeEmitSystemPromptEvent('hello')
    expect(h2).toBe(h1)
  })

  test('content >60KB truncated with ant suffix', () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    const huge = 'x'.repeat(70_000)
    maybeEmitSystemPromptEvent(huge)
    const a = fake.emitted[0]!.attributes
    // Pin: ant wK5 = 61440. When tool-details logging is off (default),
    // the content is REDACTED — but the truncated flag is still set
    // based on the original content length.
    expect(a['system_prompt_truncated']).toBe('true')
    expect(a['system_prompt_length']).toBe('70000')
  })

  test('content body redacted by default (OTEL_LOG_TOOL_DETAILS off)', () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    const orig = process.env.OTEL_LOG_TOOL_DETAILS
    delete process.env.OTEL_LOG_TOOL_DETAILS
    try {
      maybeEmitSystemPromptEvent('secret content')
      expect(fake.emitted[0]!.attributes['system_prompt']).toBe('<REDACTED>')
    } finally {
      if (orig !== undefined) process.env.OTEL_LOG_TOOL_DETAILS = orig
    }
  })

  test('content body included when OTEL_LOG_TOOL_DETAILS=1', () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    const orig = process.env.OTEL_LOG_TOOL_DETAILS
    process.env.OTEL_LOG_TOOL_DETAILS = '1'
    try {
      maybeEmitSystemPromptEvent('visible content')
      expect(fake.emitted[0]!.attributes['system_prompt']).toBe('visible content')
    } finally {
      if (orig === undefined) {
        delete process.env.OTEL_LOG_TOOL_DETAILS
      } else {
        process.env.OTEL_LOG_TOOL_DETAILS = orig
      }
    }
  })

  test('hash is stable: same string → same hash across calls', () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    const a = maybeEmitSystemPromptEvent('stable')
    __resetSystemPromptDedupForTest()
    const b = maybeEmitSystemPromptEvent('stable')
    expect(a).toBe(b)
  })

  test('hash format matches ant: sp_<12 hex chars>', () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    const h = maybeEmitSystemPromptEvent('test')!
    expect(h).toMatch(/^sp_[0-9a-f]{12}$/)
    // Pin: prefix matches ant JK5 (2911.js): `sp_${first 12 hex of sha256}`.
    expect(h.startsWith('sp_')).toBe(true)
    expect(h.slice(3).length).toBe(12)
  })
})
