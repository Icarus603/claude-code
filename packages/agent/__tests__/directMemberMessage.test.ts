import { describe, expect, mock, test } from 'bun:test'
import {
  parseDirectMemberMessage,
  sendDirectMemberMessage,
} from '../misc/directMemberMessage.js'

describe('parseDirectMemberMessage — happy path', () => {
  test('parses @name + message', () => {
    expect(parseDirectMemberMessage('@alice hello there')).toEqual({
      recipientName: 'alice',
      message: 'hello there',
    })
  })

  test('parses @name with hyphenated recipient', () => {
    expect(parseDirectMemberMessage('@team-lead status?')).toEqual({
      recipientName: 'team-lead',
      message: 'status?',
    })
  })

  test('parses @name with underscored recipient', () => {
    expect(parseDirectMemberMessage('@my_agent payload')).toEqual({
      recipientName: 'my_agent',
      message: 'payload',
    })
  })

  test('parses @name with digits in recipient', () => {
    expect(parseDirectMemberMessage('@agent42 hi')).toEqual({
      recipientName: 'agent42',
      message: 'hi',
    })
  })

  test('handles multi-line message bodies (s flag)', () => {
    expect(parseDirectMemberMessage('@alice line1\nline2')).toEqual({
      recipientName: 'alice',
      message: 'line1\nline2',
    })
  })

  test('trims surrounding whitespace from the message', () => {
    expect(parseDirectMemberMessage('@alice   spaced  ')).toEqual({
      recipientName: 'alice',
      message: 'spaced',
    })
  })
})

describe('parseDirectMemberMessage — non-matches return null', () => {
  test('no leading @ returns null', () => {
    expect(parseDirectMemberMessage('alice hello')).toBeNull()
  })

  test('@ but no name returns null', () => {
    expect(parseDirectMemberMessage('@ hello')).toBeNull()
  })

  test('@name but no body returns null', () => {
    expect(parseDirectMemberMessage('@alice')).toBeNull()
  })

  test('@name with only whitespace body returns null', () => {
    // Contract: body must contain non-whitespace AFTER trim. The regex
    // requires at least one char after the space, but trimming may
    // produce empty.
    expect(parseDirectMemberMessage('@alice    ')).toBeNull()
  })

  test('empty input returns null', () => {
    expect(parseDirectMemberMessage('')).toBeNull()
  })

  test('whitespace-only input returns null', () => {
    expect(parseDirectMemberMessage('   ')).toBeNull()
  })

  test('@name with @ in middle returns null (no whitespace boundary)', () => {
    // The regex is `^@([\w-]+)\s+(.+)$` — after the name, it requires
    // whitespace. `@bad@name hello` has `@` immediately after `bad`,
    // so the boundary fails and the whole regex fails.
    expect(parseDirectMemberMessage('@bad@name hello')).toBeNull()
  })

  test('mid-string @ does NOT match (^ anchor required)', () => {
    expect(parseDirectMemberMessage('hello @alice world')).toBeNull()
  })
})

describe('sendDirectMemberMessage — error paths', () => {
  test('returns no_team_context when teamContext is undefined', async () => {
    const result = await sendDirectMemberMessage(
      'alice',
      'msg',
      undefined as never,
      mock(async () => {}),
    )
    expect(result).toEqual({ success: false, error: 'no_team_context' })
  })

  test('returns no_team_context when teamContext is null', async () => {
    const result = await sendDirectMemberMessage(
      'alice',
      'msg',
      null as never,
      mock(async () => {}),
    )
    expect(result).toEqual({ success: false, error: 'no_team_context' })
  })

  test('returns no_team_context when writeToMailbox is undefined', async () => {
    const result = await sendDirectMemberMessage(
      'alice',
      'msg',
      { teammates: { x: { name: 'alice' } }, teamName: 't' } as never,
      undefined,
    )
    expect(result).toEqual({ success: false, error: 'no_team_context' })
  })

  test('returns unknown_recipient when name not in teammates', async () => {
    const result = await sendDirectMemberMessage(
      'bob',
      'msg',
      {
        teammates: { x: { name: 'alice' } },
        teamName: 'team-1',
      } as never,
      mock(async () => {}),
    )
    expect(result).toEqual({
      success: false,
      error: 'unknown_recipient',
      recipientName: 'bob',
    })
  })

  test('handles empty teammates object', async () => {
    const result = await sendDirectMemberMessage(
      'alice',
      'msg',
      { teammates: {}, teamName: 't' } as never,
      mock(async () => {}),
    )
    expect(result).toEqual({
      success: false,
      error: 'unknown_recipient',
      recipientName: 'alice',
    })
  })

  test('handles undefined teammates field', async () => {
    // Contract: teammates ?? {} — undefined teammates is treated as empty.
    const result = await sendDirectMemberMessage(
      'alice',
      'msg',
      { teamName: 't' } as never,
      mock(async () => {}),
    )
    expect(result).toEqual({
      success: false,
      error: 'unknown_recipient',
      recipientName: 'alice',
    })
  })
})

describe('sendDirectMemberMessage — happy path', () => {
  test('writes to mailbox and returns success', async () => {
    const writeToMailbox = mock(async () => {})
    const result = await sendDirectMemberMessage(
      'alice',
      'hello',
      {
        teammates: { id1: { name: 'alice' } },
        teamName: 'team-alpha',
      } as never,
      writeToMailbox,
    )
    expect(result).toEqual({ success: true, recipientName: 'alice' })
    expect(writeToMailbox).toHaveBeenCalledTimes(1)
    const [name, msg, teamName] = writeToMailbox.mock.calls[0]!
    expect(name).toBe('alice')
    expect(msg.from).toBe('user')
    expect(msg.text).toBe('hello')
    expect(typeof msg.timestamp).toBe('string')
    // Should be ISO8601
    expect(msg.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(teamName).toBe('team-alpha')
  })

  test('matches recipient by name field, not by teammate map key', async () => {
    // Contract: lookup is `Object.values(teammates).find(t => t.name === ...)`.
    // The map key is irrelevant — only the .name field matches.
    const writeToMailbox = mock(async () => {})
    await sendDirectMemberMessage(
      'alice',
      'msg',
      {
        teammates: {
          'random-key': { name: 'alice' }, // key ≠ name; lookup must succeed
        },
        teamName: 't',
      } as never,
      writeToMailbox,
    )
    expect(writeToMailbox).toHaveBeenCalledTimes(1)
  })
})
