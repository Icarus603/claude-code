/**
 * Tests for /goal Stop-hook helpers — port-correctness against ant
 * v2.1.136 (4513.js, 4688.js, 4689.js, 5036.js).
 *
 * The setAppState/setMessages/sessionHooks plumbing is integration —
 * we keep these tests focused on the pure helpers (KZ3/qZ3, Pj6, jf3,
 * dYK, wbK) so future regressions in those invariants are caught at
 * unit-test cost.
 */
import { describe, expect, test } from 'bun:test'
import {
  GOAL_CLEAR_KEYWORDS,
  GOAL_CONDITION_MAX_LENGTH,
  buildGoalMetaMessage,
  findGoalToRestore,
  findMostRecentMetGoalStatus,
  formatLastCheck,
  isGoalClearKeyword,
  renderActiveGoalStatus,
} from '../goalStopHook.js'
import type { Message } from '../messageShapes.js'

describe('GOAL_CONDITION_MAX_LENGTH', () => {
  test('matches ant LrH=4000', () => {
    expect(GOAL_CONDITION_MAX_LENGTH).toBe(4000)
  })
})

describe('isGoalClearKeyword (ant Pj6 / jf3)', () => {
  test('exact ant set: clear, stop, off, reset, none, cancel', () => {
    expect([...GOAL_CLEAR_KEYWORDS].sort()).toEqual(
      ['cancel', 'clear', 'none', 'off', 'reset', 'stop'],
    )
  })
  test('case-insensitive', () => {
    expect(isGoalClearKeyword('Clear')).toBe(true)
    expect(isGoalClearKeyword('STOP')).toBe(true)
    expect(isGoalClearKeyword('CaNcEl')).toBe(true)
  })
  test('returns false for non-keywords', () => {
    expect(isGoalClearKeyword('done')).toBe(false)
    expect(isGoalClearKeyword('clears')).toBe(false)
    expect(isGoalClearKeyword('clear ')).toBe(false) // caller pre-trims
    expect(isGoalClearKeyword('finish the task')).toBe(false)
  })
})

describe('formatLastCheck (ant Wj6)', () => {
  test('trims and prefixes', () => {
    expect(formatLastCheck('  reason text  ')).toBe('Last check: reason text')
  })
})

describe('buildGoalMetaMessage (ant Gj6)', () => {
  test('contains condition and directive language', () => {
    const msg = buildGoalMetaMessage('finish the migration')
    expect(msg).toContain('finish the migration')
    // Critical invariants from ant Gj6 — these phrases are the
    // load-bearing parts of the prompt; if any goes missing the agent
    // stops behaving like a goal-loop.
    expect(msg).toContain('A session-scoped Stop hook is now active')
    expect(msg).toContain('treat the condition itself as your directive')
    expect(msg).toContain('do not pause to ask the user what to do')
    expect(msg).toContain('/goal clear')
  })
})

function attachmentMessage(
  attachment: Record<string, unknown>,
  timestamp = '2026-05-12T12:00:00Z',
): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-0000-0000-000000000000',
    timestamp,
    attachment,
  } as unknown as Message
}

describe('findMostRecentMetGoalStatus (ant KZ3)', () => {
  test('returns null when no goal_status messages', () => {
    expect(findMostRecentMetGoalStatus([])).toBeNull()
  })
  test('skips sentinel met records (those are /goal set/clear markers)', () => {
    const messages = [
      attachmentMessage({
        type: 'goal_status',
        met: true,
        sentinel: true,
        condition: 'a',
      }),
    ]
    expect(findMostRecentMetGoalStatus(messages)).toBeNull()
  })
  test('skips not-met records', () => {
    const messages = [
      attachmentMessage({
        type: 'goal_status',
        met: false,
        condition: 'a',
      }),
    ]
    expect(findMostRecentMetGoalStatus(messages)).toBeNull()
  })
  test('returns most recent met:true non-sentinel record', () => {
    const messages = [
      attachmentMessage(
        { type: 'goal_status', met: true, condition: 'old' },
        '2026-05-10T12:00:00Z',
      ),
      attachmentMessage(
        {
          type: 'goal_status',
          met: true,
          condition: 'newer',
          durationMs: 3_600_000,
          iterations: 5,
        },
        '2026-05-12T12:00:00Z',
      ),
    ]
    const result = findMostRecentMetGoalStatus(messages)
    expect(result?.condition).toBe('newer')
    expect(result?.stats).toContain('5 turns')
  })
})

describe('findGoalToRestore (ant wbK)', () => {
  test('returns condition when last goal_status is met:false', () => {
    const messages = [
      attachmentMessage({
        type: 'goal_status',
        met: false,
        condition: 'in progress',
      }),
    ]
    expect(findGoalToRestore(messages)).toBe('in progress')
  })
  test('returns null when last goal_status is met:true (clean state)', () => {
    const messages = [
      attachmentMessage({
        type: 'goal_status',
        met: false,
        condition: 'older',
      }),
      attachmentMessage({
        type: 'goal_status',
        met: true,
        sentinel: true,
        condition: 'cleared',
      }),
    ]
    expect(findGoalToRestore(messages)).toBeNull()
  })
  test('null when no goal_status messages exist', () => {
    expect(findGoalToRestore([])).toBeNull()
    expect(
      findGoalToRestore([
        { type: 'user', uuid: 'u', timestamp: '', message: {} } as unknown as Message,
      ]),
    ).toBeNull()
  })
  test('null when last goal_status is failed:true (ant 1.43 BQK)', () => {
    // Source: ant v2.1.143 5083.js BQK — `q.attachment.met||q.attachment.failed`.
    // Without this guard, resume-after-impossible would silently re-arm a goal
    // the evaluator already judged unachievable. Regression test pinning the
    // 1.43 behavior.
    const messages = [
      attachmentMessage({
        type: 'goal_status',
        met: false,
        failed: true,
        condition: 'impossible thing',
      }),
    ]
    expect(findGoalToRestore(messages)).toBeNull()
  })
  test('failed:true after older active: failed terminates restore chain', () => {
    const messages = [
      attachmentMessage({
        type: 'goal_status',
        met: false,
        condition: 'older active',
      }),
      attachmentMessage({
        type: 'goal_status',
        met: false,
        failed: true,
        condition: 'newer failed',
      }),
    ]
    expect(findGoalToRestore(messages)).toBeNull()
  })
})

describe('renderActiveGoalStatus (ant qZ3)', () => {
  test('no goal: returns usage line', () => {
    const out = renderActiveGoalStatus(undefined, [])
    expect(out).toBe('No goal set. Usage: `/goal <condition>`')
  })
  test('no goal but last met record exists: shows Last line', () => {
    const messages = [
      attachmentMessage({
        type: 'goal_status',
        met: true,
        condition: 'done thing',
        iterations: 2,
      }),
    ]
    const out = renderActiveGoalStatus(undefined, messages)
    expect(out).toContain('No goal set. Usage:')
    expect(out).toContain('Last: ✔ done thing')
  })
  test('active goal renders bullet + iter + clear line', () => {
    const out = renderActiveGoalStatus(
      { condition: 'X', iterations: 0, setAt: Date.now(), tokensAtStart: 0 },
      [],
    )
    expect(out).toContain('● Goal: X')
    expect(out).toContain('not yet evaluated')
    expect(out).toContain('/goal clear')
  })
  test('active goal with iterations + lastReason renders all three lines', () => {
    const out = renderActiveGoalStatus(
      {
        condition: 'Y',
        iterations: 3,
        setAt: Date.now(),
        tokensAtStart: 0,
        lastReason: 'still failing tests',
      },
      [],
    )
    expect(out).toContain('● Goal: Y')
    expect(out).toContain('3 iterations')
    expect(out).toContain('Last check: still failing tests')
    expect(out).toContain('/goal clear')
  })
  test('1 iteration = singular', () => {
    const out = renderActiveGoalStatus(
      { condition: 'Z', iterations: 1, setAt: Date.now(), tokensAtStart: 0 },
      [],
    )
    expect(out).toContain('1 iteration')
    expect(out).not.toContain('1 iterations')
  })
})
