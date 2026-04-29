import { describe, expect, test } from 'bun:test'
import {
  formatAgentId,
  generateRequestId,
  parseAgentId,
  parseRequestId,
} from '../agentIdUtils.js'

describe('formatAgentId', () => {
  test('joins agentName + teamName with @', () => {
    expect(formatAgentId('researcher', 'my-team')).toBe('researcher@my-team')
  })
  test('handles empty teamName (degenerate but contract-allowed)', () => {
    expect(formatAgentId('alice', '')).toBe('alice@')
  })
  test('handles dashes/underscores in names', () => {
    expect(formatAgentId('team-lead_2', 'proj_alpha')).toBe(
      'team-lead_2@proj_alpha',
    )
  })
})

describe('parseAgentId', () => {
  test('splits on first @', () => {
    expect(parseAgentId('researcher@my-team')).toEqual({
      agentName: 'researcher',
      teamName: 'my-team',
    })
  })
  test('returns null when no @', () => {
    expect(parseAgentId('plain-name')).toBeNull()
  })
  test('round-trip with formatAgentId', () => {
    const id = formatAgentId('alice', 'beta')
    expect(parseAgentId(id)).toEqual({ agentName: 'alice', teamName: 'beta' })
  })
  test('first @ wins (teamName can contain @)', () => {
    expect(parseAgentId('alice@team@nested')).toEqual({
      agentName: 'alice',
      teamName: 'team@nested',
    })
  })
  test('empty agentName / teamName edge cases', () => {
    expect(parseAgentId('@team')).toEqual({ agentName: '', teamName: 'team' })
    expect(parseAgentId('alice@')).toEqual({ agentName: 'alice', teamName: '' })
  })
})

describe('generateRequestId', () => {
  test('format is `<type>-<timestamp>@<agentId>`', () => {
    const id = generateRequestId('shutdown', 'alice@team')
    expect(/^shutdown-\d+@alice@team$/.test(id)).toBe(true)
  })
  test('timestamp is current Date.now() epoch ms', () => {
    const before = Date.now()
    const id = generateRequestId('plan', 'alice@team')
    const after = Date.now()
    const ts = parseInt(id.match(/^plan-(\d+)@/)![1]!, 10)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
  test('preserves @ in agentId', () => {
    const id = generateRequestId('test', 'a@b')
    expect(id.includes('@a@b')).toBe(true)
  })
})

describe('parseRequestId', () => {
  test('parses well-formed shutdown id', () => {
    const id = 'shutdown-1700000000000@alice@team'
    expect(parseRequestId(id)).toEqual({
      requestType: 'shutdown',
      timestamp: 1700000000000,
      agentId: 'alice@team',
    })
  })
  test('handles requestType with internal dashes (last dash separates timestamp)', () => {
    const id = 'plan-approval-1700000000000@alice@team'
    expect(parseRequestId(id)).toEqual({
      requestType: 'plan-approval',
      timestamp: 1700000000000,
      agentId: 'alice@team',
    })
  })
  test('returns null when no @', () => {
    expect(parseRequestId('plain-1234567')).toBeNull()
  })
  test('returns null when prefix has no dash', () => {
    expect(parseRequestId('foo@alice')).toBeNull()
  })
  test('returns null when timestamp is non-numeric', () => {
    expect(parseRequestId('shutdown-NaN@alice')).toBeNull()
    expect(parseRequestId('shutdown-abc@alice')).toBeNull()
  })
  test('round-trip with generateRequestId', () => {
    const id = generateRequestId('test', 'a@b')
    const parsed = parseRequestId(id)
    expect(parsed?.requestType).toBe('test')
    expect(parsed?.agentId).toBe('a@b')
    expect(typeof parsed?.timestamp).toBe('number')
  })
})
