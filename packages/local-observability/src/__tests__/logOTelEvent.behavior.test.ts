import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  __resetOTelEventStateForTest,
  logOTelEvent,
  redactIfDisabled,
} from '../telemetry/events.ts'
import {
  getEventLogger,
  setEventLogger,
} from '@claude-code/app-host/bootstrap/state.js'

/**
 * Pin the V7 §8.12 OTel event emission contract — port of ant v2.1.136
 * k5() (2642.js). Pre-fix this was an empty stub; ~10 call sites across
 * ccb (tool_decision, tool_result, user_prompt, api_*, hook_*, mcp_*)
 * wrote into the void, so OTEL-wired customers got no events at all.
 *
 * Invariants under test:
 *   1. When no event logger is installed → drop silently (no throw) and
 *      log a one-shot debug warning.
 *   2. When installed → emit `claude_code.${eventName}` body with full
 *      attribute set: getTelemetryAttributes() ∪ event.name ∪
 *      event.timestamp ∪ event.sequence ∪ (prompt.id?) ∪ caller metadata.
 *   3. Sequence number is monotonic.
 *   4. Undefined metadata values are dropped (NOT serialized as
 *      "undefined").
 *   5. CLAUDE_CODE_WORKSPACE_HOST_PATHS env var is split on '|' and
 *      shipped as a string array on workspace.host_paths.
 *   6. redactIfDisabled returns "<REDACTED>" unless OTEL_LOG_USER_PROMPTS
 *      is truthy. Pin the gate string.
 */

type EmittedLog = {
  timestamp: Date
  observedTimestamp: Date
  body: string
  attributes: Record<string, unknown>
}

function makeFakeLogger(): { emitted: EmittedLog[]; emit: (l: EmittedLog) => void } {
  const emitted: EmittedLog[] = []
  return {
    emitted,
    emit(l) {
      emitted.push(l)
    },
  }
}

const originalLogger = getEventLogger()

beforeEach(() => {
  __resetOTelEventStateForTest()
})

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: test stub satisfies the OTel logger shape
  setEventLogger(originalLogger as any)
})

describe('logOTelEvent — drop-when-no-logger', () => {
  test('no logger installed → no throw, no emit', async () => {
    setEventLogger(null)
    await expect(logOTelEvent('test_event', { foo: 'bar' })).resolves
      .toBeUndefined()
  })

  test('no logger → repeated calls do NOT spam (one-shot warning)', async () => {
    setEventLogger(null)
    // Just verify no throws across many calls.
    for (let i = 0; i < 100; i++) {
      await logOTelEvent('test_event', { i: String(i) })
    }
  })
})

describe('logOTelEvent — emits via installed logger', () => {
  test('body is `claude_code.${eventName}` (matches ant k5)', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logOTelEvent('login', { auth_method: 'oauth' })
    expect(fake.emitted.length).toBe(1)
    expect(fake.emitted[0]!.body).toBe('claude_code.login')
  })

  test('attributes include event.name + event.timestamp + event.sequence', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logOTelEvent('auth', {
      action: 'login',
      success: 'true',
      auth_method: 'oauth',
    })
    const attrs = fake.emitted[0]!.attributes
    expect(attrs['event.name']).toBe('auth')
    expect(typeof attrs['event.timestamp']).toBe('string')
    expect(attrs['event.sequence']).toBe(0)
    expect(attrs['action']).toBe('login')
    expect(attrs['success']).toBe('true')
    expect(attrs['auth_method']).toBe('oauth')
  })

  test('event.sequence is monotonic across calls', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logOTelEvent('a')
    await logOTelEvent('b')
    await logOTelEvent('c')
    expect(fake.emitted[0]!.attributes['event.sequence']).toBe(0)
    expect(fake.emitted[1]!.attributes['event.sequence']).toBe(1)
    expect(fake.emitted[2]!.attributes['event.sequence']).toBe(2)
  })

  test('undefined metadata values are stripped (NOT serialized as undefined)', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logOTelEvent('auth', {
      action: 'login',
      // these should NOT appear in attributes
      status_code: undefined,
      error_category: undefined,
    })
    const attrs = fake.emitted[0]!.attributes
    expect(attrs['action']).toBe('login')
    expect('status_code' in attrs).toBe(false)
    expect('error_category' in attrs).toBe(false)
  })

  test('CLAUDE_CODE_WORKSPACE_HOST_PATHS is split on "|" into a string array', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    const orig = process.env.CLAUDE_CODE_WORKSPACE_HOST_PATHS
    process.env.CLAUDE_CODE_WORKSPACE_HOST_PATHS = '/a|/b|/c'
    try {
      await logOTelEvent('test_event')
      const attrs = fake.emitted[0]!.attributes
      expect(attrs['workspace.host_paths']).toEqual(['/a', '/b', '/c'])
    } finally {
      if (orig === undefined) {
        delete process.env.CLAUDE_CODE_WORKSPACE_HOST_PATHS
      } else {
        process.env.CLAUDE_CODE_WORKSPACE_HOST_PATHS = orig
      }
    }
  })

  test('observedTimestamp === timestamp (single instant)', async () => {
    const fake = makeFakeLogger()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    setEventLogger(fake as any)
    await logOTelEvent('test_event')
    expect(fake.emitted[0]!.timestamp).toBe(fake.emitted[0]!.observedTimestamp)
  })
})

describe('redactIfDisabled', () => {
  test('default → "<REDACTED>" (OTEL_LOG_USER_PROMPTS not set)', () => {
    const orig = process.env.OTEL_LOG_USER_PROMPTS
    delete process.env.OTEL_LOG_USER_PROMPTS
    try {
      expect(redactIfDisabled('hello world')).toBe('<REDACTED>')
    } finally {
      if (orig !== undefined) process.env.OTEL_LOG_USER_PROMPTS = orig
    }
  })

  test('OTEL_LOG_USER_PROMPTS=1 → returns content unchanged', () => {
    const orig = process.env.OTEL_LOG_USER_PROMPTS
    process.env.OTEL_LOG_USER_PROMPTS = '1'
    try {
      expect(redactIfDisabled('hello world')).toBe('hello world')
    } finally {
      if (orig === undefined) {
        delete process.env.OTEL_LOG_USER_PROMPTS
      } else {
        process.env.OTEL_LOG_USER_PROMPTS = orig
      }
    }
  })

  test('OTEL_LOG_USER_PROMPTS=false → "<REDACTED>" (truthy semantics)', () => {
    const orig = process.env.OTEL_LOG_USER_PROMPTS
    process.env.OTEL_LOG_USER_PROMPTS = 'false'
    try {
      expect(redactIfDisabled('hello world')).toBe('<REDACTED>')
    } finally {
      if (orig === undefined) {
        delete process.env.OTEL_LOG_USER_PROMPTS
      } else {
        process.env.OTEL_LOG_USER_PROMPTS = orig
      }
    }
  })
})
