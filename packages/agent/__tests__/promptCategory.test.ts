import { describe, expect, test } from 'bun:test'
import { getQuerySourceForAgent } from '../promptCategory.js'

describe('getQuerySourceForAgent', () => {
  // This drives the analytics tag distinguishing built-in from custom
  // agents. Critical for telemetry attribution — if the categories
  // collapse, A/B-test analysis on agent types becomes impossible.

  test('built-in agent with type → "agent:builtin:<type>"', () => {
    expect(getQuerySourceForAgent('reviewer', true)).toBe(
      'agent:builtin:reviewer',
    )
  })

  test('built-in agent without type → "agent:default"', () => {
    expect(getQuerySourceForAgent(undefined, true)).toBe('agent:default')
  })

  test('built-in agent with empty-string type → "agent:default" (empty falsy)', () => {
    // Contract: the ternary `agentType ? ... : 'agent:default'` treats
    // '' as falsy. If a built-in agent passes empty string, it falls
    // back to default — NOT "agent:builtin:".
    expect(getQuerySourceForAgent('', true)).toBe('agent:default')
  })

  test('custom agent with type → "agent:custom" (type is IGNORED for non-builtins)', () => {
    // Critical: the type field is only relevant for built-in agents.
    // For custom agents, all of them roll up to a single "agent:custom"
    // category for analytics.
    expect(getQuerySourceForAgent('myCustomAgent', false)).toBe('agent:custom')
  })

  test('custom agent without type → "agent:custom"', () => {
    expect(getQuerySourceForAgent(undefined, false)).toBe('agent:custom')
  })

  test('builtin agent type with special chars (colons, spaces) is interpolated as-is', () => {
    // The function does no escaping. Caller is responsible for sane
    // agent-type names — this test documents the no-escape contract.
    expect(getQuerySourceForAgent('weird:type-name', true)).toBe(
      'agent:builtin:weird:type-name',
    )
  })

  test('returns a non-empty string in all 4 quadrants', () => {
    const samples = [
      getQuerySourceForAgent('a', true),
      getQuerySourceForAgent(undefined, true),
      getQuerySourceForAgent('a', false),
      getQuerySourceForAgent(undefined, false),
    ]
    for (const s of samples) {
      expect(typeof s).toBe('string')
      expect(s.length).toBeGreaterThan(0)
    }
  })
})
