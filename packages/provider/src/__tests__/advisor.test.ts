/**
 * Tests for advisor pure helpers — isAdvisorBlock, modelSupportsAdvisor,
 * isValidAdvisorModel, getAdvisorUsage.
 *
 * The advisor is a server-side reviewer-model tool: when the model
 * calls `advisor`, the API forwards the entire conversation history
 * to a stronger model. The blocks come back as `server_tool_use`
 * (request) and `advisor_tool_result` (reply).
 *
 * Wrong block predicate = advisor blocks render as raw JSON in the
 * REPL transcript or skip permission gating. Wrong model gate =
 * sends the advisor request to a model the API rejects.
 */
import { describe, expect, test } from 'bun:test'
import {
  getAdvisorUsage,
  isAdvisorBlock,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from '../advisor.js'

describe('isAdvisorBlock — type discrimination', () => {
  test('advisor_tool_result block → true (regardless of name)', () => {
    expect(
      isAdvisorBlock({ type: 'advisor_tool_result' }),
    ).toBe(true)
  })

  test('server_tool_use with name=advisor → true', () => {
    expect(
      isAdvisorBlock({ type: 'server_tool_use', name: 'advisor' }),
    ).toBe(true)
  })

  test('server_tool_use with different name → false', () => {
    expect(
      isAdvisorBlock({ type: 'server_tool_use', name: 'other' }),
    ).toBe(false)
  })

  test('server_tool_use without name → false', () => {
    expect(isAdvisorBlock({ type: 'server_tool_use' })).toBe(false)
  })

  test('text block → false', () => {
    expect(isAdvisorBlock({ type: 'text' })).toBe(false)
  })

  test('regular tool_use → false (only server_tool_use can be advisor)', () => {
    expect(
      isAdvisorBlock({ type: 'tool_use', name: 'advisor' }),
    ).toBe(false)
  })

  test('tool_result (not advisor_tool_result) → false', () => {
    expect(isAdvisorBlock({ type: 'tool_result' })).toBe(false)
  })
})

describe('modelSupportsAdvisor — model gate', () => {
  test('opus-4-7 supports advisor', () => {
    expect(modelSupportsAdvisor('claude-opus-4-7')).toBe(true)
  })

  test('opus-4-6 supports advisor', () => {
    expect(modelSupportsAdvisor('claude-opus-4-6')).toBe(true)
  })

  test('sonnet-4-6 supports advisor', () => {
    expect(modelSupportsAdvisor('claude-sonnet-4-6')).toBe(true)
  })

  test('case-insensitive', () => {
    expect(modelSupportsAdvisor('CLAUDE-OPUS-4-7')).toBe(true)
    expect(modelSupportsAdvisor('Claude-Opus-4-7')).toBe(true)
  })

  test('older opus (4.5) does NOT support advisor', () => {
    expect(modelSupportsAdvisor('claude-opus-4-5')).toBe(false)
  })

  test('haiku does NOT support advisor', () => {
    expect(modelSupportsAdvisor('claude-haiku-4-5')).toBe(false)
  })

  test('older sonnet (4.5) does NOT support advisor', () => {
    expect(modelSupportsAdvisor('claude-sonnet-4-5')).toBe(false)
  })

  test('unrelated model name → false', () => {
    expect(modelSupportsAdvisor('gpt-4')).toBe(false)
    expect(modelSupportsAdvisor('gemini-pro')).toBe(false)
  })

  test('model substring match (date-suffixed full ID)', () => {
    expect(modelSupportsAdvisor('claude-opus-4-7-20260101')).toBe(true)
  })
})

describe('isValidAdvisorModel — same gate as modelSupportsAdvisor for non-ant', () => {
  test('opus-4-7 valid', () => {
    expect(isValidAdvisorModel('claude-opus-4-7')).toBe(true)
  })

  test('opus-4-6 valid', () => {
    expect(isValidAdvisorModel('claude-opus-4-6')).toBe(true)
  })

  test('sonnet-4-6 valid', () => {
    expect(isValidAdvisorModel('claude-sonnet-4-6')).toBe(true)
  })

  test('haiku invalid', () => {
    expect(isValidAdvisorModel('claude-haiku-4-5')).toBe(false)
  })

  test('older opus invalid', () => {
    expect(isValidAdvisorModel('claude-opus-4-5')).toBe(false)
  })
})

describe('getAdvisorUsage — extract advisor messages from BetaUsage', () => {
  test('usage with no iterations → empty array', () => {
    expect(getAdvisorUsage({} as never)).toEqual([])
  })

  test('usage with null iterations → empty array', () => {
    expect(getAdvisorUsage({ iterations: null } as never)).toEqual([])
  })

  test('usage with empty iterations → empty array', () => {
    expect(getAdvisorUsage({ iterations: [] } as never)).toEqual([])
  })

  test('extracts only advisor_message-typed iterations', () => {
    const usage = {
      iterations: [
        { type: 'advisor_message', model: 'claude-opus-4-7' },
        { type: 'main_message', model: 'claude-sonnet-4-6' },
        { type: 'advisor_message', model: 'claude-opus-4-7' },
      ],
    } as never
    const r = getAdvisorUsage(usage)
    expect(r).toHaveLength(2)
    expect(r.every(it => (it as { type: string }).type === 'advisor_message')).toBe(true)
  })

  test('preserves model field on each result', () => {
    const usage = {
      iterations: [
        { type: 'advisor_message', model: 'claude-opus-4-7' },
      ],
    } as never
    const r = getAdvisorUsage(usage)
    expect(r[0]?.model).toBe('claude-opus-4-7')
  })

  test('non-advisor iterations excluded', () => {
    const usage = {
      iterations: [
        { type: 'main_message' },
        { type: 'tool_use' },
        { type: 'advisor_message' },
      ],
    } as never
    const r = getAdvisorUsage(usage)
    expect(r).toHaveLength(1)
  })

  test('order of advisor messages preserved', () => {
    const usage = {
      iterations: [
        { type: 'advisor_message', model: 'first' },
        { type: 'main_message' },
        { type: 'advisor_message', model: 'second' },
      ],
    } as never
    const r = getAdvisorUsage(usage)
    expect(r[0]?.model).toBe('first')
    expect(r[1]?.model).toBe('second')
  })
})
