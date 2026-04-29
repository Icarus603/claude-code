/**
 * Tests for conversationChain.ts — pure linearization of the
 * parentUuid DAG into a flat transcript on resume.
 *
 * Wrong walk = either:
 *   - missing messages (chain truncation, #22453 class)
 *   - duplicated messages (chain expansion)
 *   - wrong order (parallel tool_results scrambled)
 *
 * The walk is parent→child via parentUuid, which is a single-parent
 * link list. The DAG topology comes from parallel tool_use blocks
 * (N tool_uses → N sibling assistants with same message.id but
 * distinct uuids). The post-pass `recoverOrphanedParallelToolResults`
 * splices siblings + their tool_results back in.
 */
import { describe, expect, mock, test } from 'bun:test'
import type { UUID } from 'crypto'
import type { TranscriptMessage } from '@claude-code/agent/logsTypes.js'

// logEvent is a global side-effect — stub it.
const realObs = await import('@claude-code/local-observability')
mock.module('@claude-code/local-observability', () => ({
  ...realObs,
  logEvent: () => {},
}))
const realLog = await import('@claude-code/local-observability/logging')
mock.module('@claude-code/local-observability/logging', () => ({
  ...realLog,
  logError: () => {},
}))

const { buildConversationChain, checkResumeConsistency } = await import(
  '../conversationChain.js'
)

function user(uuid: string, parent?: string): TranscriptMessage {
  return {
    type: 'user',
    uuid: uuid as UUID,
    parentUuid: parent as UUID | undefined,
    timestamp: '2026-04-30T00:00:00Z',
    message: { content: 'msg' },
  } as TranscriptMessage
}

function assistant(
  uuid: string,
  parent: string | undefined,
  messageId?: string,
  content: unknown[] = [],
): TranscriptMessage {
  return {
    type: 'assistant',
    uuid: uuid as UUID,
    parentUuid: parent as UUID | undefined,
    timestamp: '2026-04-30T00:00:00Z',
    message: { id: messageId, content },
  } as TranscriptMessage
}

function toolResult(
  uuid: string,
  parent: string,
  toolUseId: string,
): TranscriptMessage {
  return {
    type: 'user',
    uuid: uuid as UUID,
    parentUuid: parent as UUID,
    timestamp: '2026-04-30T00:00:00Z',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content: 'ok' },
      ],
    },
  } as TranscriptMessage
}

function toMap(...msgs: TranscriptMessage[]): Map<UUID, TranscriptMessage> {
  return new Map(msgs.map(m => [m.uuid, m]))
}

describe('buildConversationChain — basic linearization', () => {
  test('single message returns [message]', () => {
    const m = user('u1')
    const result = buildConversationChain(toMap(m), m)
    expect(result).toEqual([m])
  })

  test('linear chain: a → b → c, leaf=c', () => {
    const a = user('u1')
    const b = user('u2', 'u1')
    const c = user('u3', 'u2')
    const result = buildConversationChain(toMap(a, b, c), c)
    expect(result.map(m => m.uuid)).toEqual(['u1', 'u2', 'u3'])
  })

  test('orphaned leaf (no parent in map) returns [leaf] only', () => {
    const orphan = user('u1', 'parent-not-in-map')
    const result = buildConversationChain(toMap(orphan), orphan)
    expect(result).toEqual([orphan])
  })

  test('cycle in parentUuid is broken (returns partial transcript)', () => {
    // a → b → a (cycle)
    const a = { ...user('u1', 'u2') }
    const b = { ...user('u2', 'u1') }
    const result = buildConversationChain(toMap(a, b), b)
    // Walk: b (uuid=u2) → a (uuid=u1, parent=u2 already seen → break)
    // Reversed: [a, b]. Partial transcript has both, no infinite loop.
    expect(result).toHaveLength(2)
  })

  test('leaf with parentUuid pointing to missing message stops walk', () => {
    const leaf = user('u3', 'missing')
    const result = buildConversationChain(toMap(leaf), leaf)
    expect(result).toEqual([leaf])
  })
})

describe('buildConversationChain — parallel tool_results recovery', () => {
  test('two parallel tool_uses (same message.id): both siblings + TRs preserved', () => {
    // Streaming emits one assistant message per content_block_stop.
    // 2 parallel tool_uses → asstA + asstB with same message.id but
    // different uuids. Each has its own tool_result.
    //
    // Single-parent walk follows: prev → asstA → TR_A → next
    // Drops asstB and TR_B. Post-pass should recover them.
    const prev = user('prev')
    const asstA = assistant('aA', 'prev', 'msg-1')
    const asstB = assistant('aB', 'prev', 'msg-1')
    const trA = toolResult('trA', 'aA', 'callA')
    const trB = toolResult('trB', 'aB', 'callB')
    const next = user('next', 'trA') // walk continues from trA

    const map = toMap(prev, asstA, asstB, trA, trB, next)
    const result = buildConversationChain(map, next)
    const uuids = result.map(m => m.uuid)
    // All 5 messages should be in the chain (in some sensible order).
    expect(uuids).toContain('prev')
    expect(uuids).toContain('aA')
    expect(uuids).toContain('aB')
    expect(uuids).toContain('trA')
    expect(uuids).toContain('trB')
    expect(uuids).toContain('next')
  })

  test('no parallel tool_results: chain unchanged', () => {
    const a = user('u1')
    const b = user('u2', 'u1')
    const result = buildConversationChain(toMap(a, b), b)
    expect(result.map(m => m.uuid)).toEqual(['u1', 'u2'])
  })

  test('empty messages map returns [leaf] (no recovery possible)', () => {
    const orphan = user('u1', 'p')
    const result = buildConversationChain(new Map(), orphan)
    expect(result).toEqual([orphan])
  })

  test('assistant without message.id is not grouped (no sibling recovery)', () => {
    // No message.id → siblingsByMsgId can't index it → no recovery.
    const prev = user('prev')
    const asst = assistant('a1', 'prev') // no messageId
    const result = buildConversationChain(toMap(prev, asst), asst)
    expect(result.map(m => m.uuid)).toEqual(['prev', 'a1'])
  })
})

describe('checkResumeConsistency — telemetry', () => {
  test('does not throw on chain without turn_duration checkpoint', () => {
    const chain = [user('u1'), user('u2')]
    expect(() => checkResumeConsistency(chain as never)).not.toThrow()
  })

  test('does not throw on empty chain', () => {
    expect(() => checkResumeConsistency([])).not.toThrow()
  })

  test('does not throw when turn_duration has no messageCount', () => {
    const chain = [
      user('u1'),
      {
        type: 'system',
        subtype: 'turn_duration',
        uuid: 's1' as UUID,
      } as never,
    ]
    expect(() => checkResumeConsistency(chain)).not.toThrow()
  })

  test('does not throw with valid turn_duration + messageCount', () => {
    const chain = [
      user('u1'),
      user('u2'),
      {
        type: 'system',
        subtype: 'turn_duration',
        messageCount: 2,
        uuid: 's1' as UUID,
      } as never,
    ]
    // Function emits telemetry; we just lock no-throw on the success path.
    expect(() => checkResumeConsistency(chain)).not.toThrow()
  })
})
