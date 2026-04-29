import { describe, expect, test } from 'bun:test'
import { groupMessagesByApiRound } from '../compaction/grouping.js'

type Msg = Parameters<typeof groupMessagesByApiRound>[0][number]

function user(): Msg {
  return { type: 'user' } as Msg
}
function assistant(id: string): Msg {
  return { type: 'assistant', message: { id } } as Msg
}
function toolResult(): Msg {
  return { type: 'user' } as Msg
}

describe('groupMessagesByApiRound', () => {
  // Contract: groups messages into "rounds" — each round starts with an
  // assistant message that has a NEW message.id (different from the prior
  // assistant's id). Subsequent user/system messages stay in the current
  // round until a new assistant id appears.
  //
  // Critical for compaction: the grouping decides what gets snipped or
  // kept as a unit. If a refactor breaks the boundary detection,
  // partial-round snips would corrupt tool_use ↔ tool_result pairing.

  test('empty input returns empty', () => {
    expect(groupMessagesByApiRound([])).toEqual([])
  })

  test('single user message → one group of length 1', () => {
    const result = groupMessagesByApiRound([user()])
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(1)
  })

  test('user + assistant + user → splits at assistant boundary', () => {
    // Trace: u1 → current=[u1]; a1 → current.length>0 && a1.id!==undefined
    // → push [u1], current=[a1]; tr → current=[a1,tr]; END → push.
    // Result: [[u1], [a1, tr]]
    const messages = [user(), assistant('a1'), toolResult()]
    const result = groupMessagesByApiRound(messages)
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(1)
    expect(result[1]).toHaveLength(2)
  })

  test('two assistants with DIFFERENT ids → three groups', () => {
    // Trace: u → [u]; a1 → boundary fires, push [u], current=[a1];
    // a2 → boundary fires, push [a1], current=[a2]; END → push.
    // Result: [[u], [a1], [a2]]
    const messages = [user(), assistant('a1'), assistant('a2')]
    const result = groupMessagesByApiRound(messages)
    expect(result).toHaveLength(3)
    expect(result[0]).toHaveLength(1)
    expect(result[1]).toHaveLength(1)
    expect(result[2]).toHaveLength(1)
  })

  test('two assistants with SAME id → first triggers boundary, second stays in same group', () => {
    // Trace: u → [u]; a1 → boundary fires (lastAssistantId was undefined,
    // a1.id is 'a1', they differ), push [u], current=[a1]; second a1 →
    // a1.id === lastAssistantId so NO boundary; current=[a1, a1]; END.
    // Result: [[u], [a1, a1]]
    const messages = [user(), assistant('a1'), assistant('a1')]
    const result = groupMessagesByApiRound(messages)
    expect(result).toHaveLength(2)
    expect(result[1]).toHaveLength(2) // both a1's together
  })

  test('assistant without id field — boundary fires once but subsequent ones do not', () => {
    // Trace: u → [u]; assistant w/ id=undefined → boundary check:
    // msg.id (undefined) !== lastAssistantId (undefined) → FALSE,
    // no boundary; current=[u, asst]; END → push.
    // Result: [[u, asst]] — single group.
    const messages = [
      user(),
      { type: 'assistant', message: {} } as Msg,
    ]
    const result = groupMessagesByApiRound(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(2)
  })

  test('typical pattern: u → a1 → tr → a2 → u → a3 → tr → 4 groups', () => {
    // Trace each step:
    //  u → [u]
    //  a1 → boundary (current.len>0 && a1!==undef) → push [u], cur=[a1]
    //  tr → cur=[a1, tr]
    //  a2 → boundary → push [a1, tr], cur=[a2]
    //  u → cur=[a2, u]
    //  a3 → boundary → push [a2, u], cur=[a3]
    //  tr → cur=[a3, tr]
    //  END → push [a3, tr]
    // Result: [[u], [a1, tr], [a2, u], [a3, tr]]
    const messages = [
      user(),
      assistant('a1'),
      toolResult(),
      assistant('a2'),
      user(),
      assistant('a3'),
      toolResult(),
    ]
    const result = groupMessagesByApiRound(messages)
    expect(result).toHaveLength(4)
    expect(result[0]).toHaveLength(1)
    expect(result[1]).toHaveLength(2)
    expect(result[2]).toHaveLength(2)
    expect(result[3]).toHaveLength(2)
  })

  test('first assistant in stream when current is empty — no boundary fires', () => {
    // current.length === 0 means boundary check fails. Stream starting
    // with assistant produces a single group, not an empty leading one.
    const messages = [assistant('a1')]
    const result = groupMessagesByApiRound(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(1)
  })

  test('preserves message order within and across groups', () => {
    const u1: Msg = { type: 'user', tag: 'first' } as never
    const a1: Msg = { type: 'assistant', message: { id: 'a1' } } as Msg
    const u2: Msg = { type: 'user', tag: 'second' } as never
    const a2: Msg = { type: 'assistant', message: { id: 'a2' } } as Msg
    const result = groupMessagesByApiRound([u1, a1, u2, a2])
    // Trace: u1 → [u1]; a1 → push, cur=[a1]; u2 → cur=[a1, u2];
    //   a2 → push, cur=[a2]; END → push. → [[u1], [a1, u2], [a2]]
    expect(result).toHaveLength(3)
    expect(result[0]?.[0]).toBe(u1)
    expect(result[1]?.[0]).toBe(a1)
    expect(result[1]?.[1]).toBe(u2)
    expect(result[2]?.[0]).toBe(a2)
  })

  test('does NOT mutate input array', () => {
    const messages = [user(), assistant('a1'), assistant('a2')]
    const before = messages.length
    groupMessagesByApiRound(messages)
    expect(messages.length).toBe(before)
  })

  test('flat-concat of all groups equals the original sequence', () => {
    const messages = [
      user(),
      assistant('a1'),
      toolResult(),
      assistant('a2'),
    ]
    const result = groupMessagesByApiRound(messages)
    const flat = result.flat()
    expect(flat).toEqual(messages)
  })
})
