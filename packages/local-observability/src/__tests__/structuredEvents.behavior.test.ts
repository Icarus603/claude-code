import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  __resetOTelEventStateForTest,
} from '../telemetry/events.ts'
import {
  logApiRetriesExhaustedEvent,
  logAtMentionEvent,
  logCompactionEvent,
  logFeedbackSurveyEvent,
  logInternalErrorEvent,
  logMcpServerConnectionEvent,
  logPermissionModeChangeEvent,
  logPluginInstalledEvent,
  logSkillActivatedEvent,
  logSystemPromptEvent,
} from '../telemetry/structuredEvents.ts'
import {
  getEventLogger,
  setEventLogger,
} from '@claude-code/app-host/bootstrap/state.js'

/**
 * Pin port of ant 2642.js / 2643.js / 2822.js / 2911.js / 2914.js /
 * 4054.js / 5059.js typed OTel event helpers. Each helper wraps
 * logOTelEvent with the exact metadata shape ant emits.
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
  setEventLogger(originalLogger as never)
})

describe('logCompactionEvent (ant ZzH 2642.js)', () => {
  test('body=claude_code.compaction, success serialised as string', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logCompactionEvent({
      trigger: 'manual',
      success: true,
      durationMs: 1234,
      preTokens: 100_000,
      postTokens: 8_000,
    })
    expect(fake.emitted[0]!.body).toBe('claude_code.compaction')
    const a = fake.emitted[0]!.attributes
    expect(a['trigger']).toBe('manual')
    expect(a['success']).toBe('true')
    expect(a['duration_ms']).toBe('1234')
    expect(a['pre_tokens']).toBe('100000')
    expect(a['post_tokens']).toBe('8000')
  })

  test('duration_ms is Math.round of durationMs (matches ant)', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logCompactionEvent({
      trigger: 'auto',
      success: true,
      durationMs: 1234.7,
    })
    expect(fake.emitted[0]!.attributes['duration_ms']).toBe('1235')
  })

  test('pre/post tokens optional → not in attributes when undefined', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logCompactionEvent({
      trigger: 'auto',
      success: false,
      durationMs: 0,
      error: 'rate_limited',
    })
    const a = fake.emitted[0]!.attributes
    expect('pre_tokens' in a).toBe(false)
    expect('post_tokens' in a).toBe(false)
    expect(a['error']).toBe('rate_limited')
  })
})

describe('logInternalErrorEvent (ant LF9 2642.js)', () => {
  test('emits with error_name from constructor when generic Error', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    class CustomError extends Error {
      override name = 'Error' // intentionally generic to test fallback
    }
    logInternalErrorEvent(new CustomError('boom'))
    await new Promise(r => setTimeout(r, 20))
    expect(fake.emitted[0]?.attributes['error_name']).toBe('CustomError')
  })

  test('error_code passes through when /^[A-Z][A-Z0-9_]*$/', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    const e = Object.assign(new Error('x'), { code: 'ENOENT' })
    logInternalErrorEvent(e)
    await new Promise(r => setTimeout(r, 20))
    expect(fake.emitted[0]?.attributes['error_code']).toBe('ENOENT')
  })

  test('error_code undefined when not matching the strict regex', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    const e = Object.assign(new Error('x'), { code: 'lowercase' })
    logInternalErrorEvent(e)
    await new Promise(r => setTimeout(r, 20))
    expect(fake.emitted[0]?.attributes['error_code']).toBeUndefined()
  })

  test('reentrancy guard prevents infinite recursion', () => {
    let depth = 0
    setEventLogger({
      emit: () => {
        depth++
        if (depth > 5) throw new Error('hard stop — guard failed')
        // simulate emit itself throwing, which calling code could
        // then trap and re-call the error reporter
        throw new Error('emit failed')
      },
    } as never)
    // If guard works, no infinite recursion; should return quickly.
    expect(() => {
      logInternalErrorEvent(new Error('outer'))
    }).not.toThrow()
  })
})

describe('logAtMentionEvent (ant Ak 2642.js)', () => {
  test('mention_type + success (string-cast)', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logAtMentionEvent({ mentionType: 'file', success: true })
    expect(fake.emitted[0]!.body).toBe('claude_code.at_mention')
    expect(fake.emitted[0]!.attributes['mention_type']).toBe('file')
    expect(fake.emitted[0]!.attributes['success']).toBe('true')
  })

  test('success=false serialised as "false"', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logAtMentionEvent({ mentionType: 'directory', success: false })
    expect(fake.emitted[0]!.attributes['success']).toBe('false')
  })
})

describe('logPermissionModeChangeEvent (ant Ts 2642.js)', () => {
  test('emits with from_mode + to_mode + optional trigger', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logPermissionModeChangeEvent({
      from: 'default',
      to: 'plan',
      trigger: 'shift+tab',
    })
    const a = fake.emitted[0]!.attributes
    expect(a['from_mode']).toBe('default')
    expect(a['to_mode']).toBe('plan')
    expect(a['trigger']).toBe('shift+tab')
  })

  test('from === to → no event emitted (no-op transition)', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logPermissionModeChangeEvent({ from: 'plan', to: 'plan' })
    expect(fake.emitted.length).toBe(0)
  })

  test('trigger omitted when undefined', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logPermissionModeChangeEvent({ from: 'default', to: 'plan' })
    expect('trigger' in fake.emitted[0]!.attributes).toBe(false)
  })
})

describe('logMcpServerConnectionEvent (ant QN8 4054.js)', () => {
  test('PII fields gated by includeIdentifyingFields=false (default)', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logMcpServerConnectionEvent({
      serverName: 'my-server',
      transportType: 'stdio',
      serverScope: 'user',
      status: 'success',
      durationMs: 250,
      errorDetail: 'connection error',
    })
    const a = fake.emitted[0]!.attributes
    expect('server_name' in a).toBe(false)
    expect('error' in a).toBe(false)
    expect(a['transport_type']).toBe('stdio')
    expect(a['server_scope']).toBe('user')
    expect(a['duration_ms']).toBe('250')
  })

  test('PII fields flow through when includeIdentifyingFields=true', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logMcpServerConnectionEvent({
      serverName: 'my-server',
      transportType: 'stdio',
      serverScope: 'user',
      status: 'failure',
      durationMs: 30,
      errorCode: 'ETIMEDOUT',
      errorDetail: 'connect timeout',
      includeIdentifyingFields: true,
    })
    const a = fake.emitted[0]!.attributes
    expect(a['server_name']).toBe('my-server')
    expect(a['error']).toBe('connect timeout')
    expect(a['error_code']).toBe('ETIMEDOUT')
  })

  test('transport_type defaults to "stdio" when not provided', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logMcpServerConnectionEvent({
      serverName: 's',
      serverScope: 'user',
      status: 'success',
      durationMs: 0,
    })
    expect(fake.emitted[0]!.attributes['transport_type']).toBe('stdio')
  })
})

describe('logSystemPromptEvent (ant 2911.js)', () => {
  test('truncated flag emitted as "true" string when true', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logSystemPromptEvent({
      hash: 'abc123',
      content: 'You are Claude...',
      length: 12345,
      truncated: true,
    })
    const a = fake.emitted[0]!.attributes
    expect(a['system_prompt_hash']).toBe('abc123')
    expect(a['system_prompt']).toBe('You are Claude...')
    expect(a['system_prompt_length']).toBe('12345')
    expect(a['system_prompt_truncated']).toBe('true')
  })

  test('truncated=false → field omitted (matches ant ternary)', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logSystemPromptEvent({
      hash: 'x',
      content: 'y',
      length: 1,
      truncated: false,
    })
    expect('system_prompt_truncated' in fake.emitted[0]!.attributes).toBe(false)
  })
})

describe('logApiRetriesExhaustedEvent (ant 2914.js)', () => {
  test('full payload roundtrips with stringified totals', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logApiRetriesExhaustedEvent({
      model: 'claude-opus-4-7',
      error: 'rate_limit',
      statusCode: '429',
      totalAttempts: 5,
      totalRetryDurationMs: 35_000,
      speed: 'fast',
      querySource: 'user',
      effort: 'high',
    })
    const a = fake.emitted[0]!.attributes
    expect(a['model']).toBe('claude-opus-4-7')
    expect(a['total_attempts']).toBe('5')
    expect(a['total_retry_duration_ms']).toBe('35000')
    expect(a['speed']).toBe('fast')
    expect(a['query_source']).toBe('user')
    expect(a['effort']).toBe('high')
  })

  test('optional fields omitted when undefined', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logApiRetriesExhaustedEvent({
      model: 'claude-opus-4-7',
      error: 'network',
      totalAttempts: 3,
      totalRetryDurationMs: 1000,
      speed: 'normal',
    })
    const a = fake.emitted[0]!.attributes
    expect('status_code' in a).toBe(false)
    expect('query_source' in a).toBe(false)
    expect('effort' in a).toBe(false)
  })
})

describe('logSkillActivatedEvent (ant 2643.js)', () => {
  test('official skill name flows through verbatim', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logSkillActivatedEvent({
      skillName: 'pdf-skill',
      invocationTrigger: 'autonomous',
      skillSource: 'bundled',
      skillKind: 'tool',
      isOfficial: true,
    })
    expect(fake.emitted[0]!.attributes['skill.name']).toBe('pdf-skill')
  })

  test('NON-official skill name redacted as "custom_skill"', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logSkillActivatedEvent({
      skillName: 'my-secret-skill',
      invocationTrigger: 'autonomous',
      isOfficial: false,
    })
    expect(fake.emitted[0]!.attributes['skill.name']).toBe('custom_skill')
  })

  test('plugin.name + marketplace.name only when official', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logSkillActivatedEvent({
      skillName: 'x',
      invocationTrigger: 'autonomous',
      isOfficial: false,
      pluginName: 'p',
      marketplaceName: 'm',
    })
    const a = fake.emitted[0]!.attributes
    expect('plugin.name' in a).toBe(false)
    expect('marketplace.name' in a).toBe(false)
  })
})

describe('logPluginInstalledEvent (ant 2822.js)', () => {
  test('marketplace.is_official always present (string-cast)', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logPluginInstalledEvent({
      pluginName: 'x',
      isOfficialMarketplace: true,
    })
    expect(fake.emitted[0]!.attributes['marketplace.is_official']).toBe('true')
  })

  test('plugin identity gated on includeIdentifyingFields', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logPluginInstalledEvent({
      pluginName: 'x',
      pluginVersion: '1.0',
      marketplaceName: 'm',
      isOfficialMarketplace: false,
      includeIdentifyingFields: true,
    })
    const a = fake.emitted[0]!.attributes
    expect(a['plugin.name']).toBe('x')
    expect(a['plugin.version']).toBe('1.0')
    expect(a['marketplace.name']).toBe('m')
  })

  test('PII suppressed by default', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logPluginInstalledEvent({
      pluginName: 'x',
      isOfficialMarketplace: false,
    })
    const a = fake.emitted[0]!.attributes
    expect('plugin.name' in a).toBe(false)
  })
})

describe('logFeedbackSurveyEvent (ant 5059.js)', () => {
  test('appeared event with full payload', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logFeedbackSurveyEvent({
      eventType: 'appeared',
      appearanceId: 'a1',
      surveyType: 'nps',
      enabledViaOverride: true,
    })
    const a = fake.emitted[0]!.attributes
    expect(a['event_type']).toBe('appeared')
    expect(a['appearance_id']).toBe('a1')
    expect(a['survey_type']).toBe('nps')
    expect(a['enabled_via_override']).toBe('true')
  })

  test('enabled_via_override omitted when not provided', async () => {
    const fake = makeFakeLogger()
    setEventLogger(fake as never)
    await logFeedbackSurveyEvent({
      eventType: 'submitted',
      appearanceId: 'a1',
      surveyType: 'nps',
    })
    expect('enabled_via_override' in fake.emitted[0]!.attributes).toBe(false)
  })
})
