/**
 * Tests for /goal Stop-hook helpers — port-correctness against ant
 * v2.1.136 (4513.js, 4688.js, 4689.js, 5036.js).
 *
 * Coverage includes pure helpers (KZ3/qZ3, Pj6, jf3, dYK, wbK) plus the
 * session-hook/AppState mutation path. /goal is a state machine: helper-only
 * tests miss hook replacement, sentinel persistence, and restore side effects.
 */
import { describe, expect, mock, test } from 'bun:test'

const realHooksConfigSnapshot = await import('../hooksConfigSnapshot.js')
mock.module('../hooksConfigSnapshot.js', () => ({
  ...realHooksConfigSnapshot,
  shouldDisableAllHooksIncludingManaged: () => false,
  shouldAllowManagedHooksOnly: () => false,
}))
import {
  GOAL_CLEAR_KEYWORDS,
  GOAL_CONDITION_MAX_LENGTH,
  addGoalStopHook,
  buildGoalMetaMessage,
  clearGoalStopHook,
  findGoalToRestore,
  findMostRecentMetGoalStatus,
  formatLastCheck,
  isGoalClearKeyword,
  pauseGoalStopHook,
  renderActiveGoalStatus,
  restoreGoalFromTranscript,
  resumeGoalStopHook,
} from '../goalStopHook.js'
import { getSessionHooks } from '../hooks/sessionHooks.js'
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

type TestState = {
  activeGoal?: {
    condition: string
    iterations: number
    setAt: number
    tokensAtStart: number
    lastReason?: string
    paused?: boolean
  }
  sessionHooks: Map<string, { hooks: Record<string, unknown[]> }>
}

function createGoalContext(sessionId = 'session-goal') {
  let state: TestState = { sessionHooks: new Map() }
  let messages: Message[] = []
  const setAppState = (updater: (prev: TestState) => TestState) => {
    state = updater(state)
  }
  const setMessages = (updater: (prev: Message[]) => Message[]) => {
    messages = updater(messages)
  }
  return {
    sessionId,
    ctx: {
      getAppState: () => state as any,
      setAppState: setAppState as any,
      setMessages,
      sessionId,
      getMessages: () => messages,
    },
    get state() {
      return state
    },
    get messages() {
      return messages
    },
  }
}

function stopPromptHooks(state: TestState, sessionId: string): string[] {
  const stopHooks = getSessionHooks(state as any, sessionId, 'Stop').get('Stop') ?? []
  return stopHooks.flatMap(matcher =>
    matcher.hooks
      .filter(hook => hook.type === 'prompt')
      .map(hook => (hook as { prompt: string }).prompt),
  )
}

describe('goal Stop-hook lifecycle mutation', () => {
  test('addGoalStopHook installs one Stop prompt hook, activeGoal, and set sentinel', () => {
    const harness = createGoalContext()

    addGoalStopHook('ship the patch', harness.ctx)

    expect(stopPromptHooks(harness.state, harness.sessionId)).toEqual([
      'ship the patch',
    ])
    expect(harness.state.activeGoal?.condition).toBe('ship the patch')
    expect(harness.state.activeGoal?.iterations).toBe(0)
    expect(harness.state.activeGoal?.tokensAtStart).toBeNumber()
    expect(harness.messages).toHaveLength(1)
    expect((harness.messages[0] as any).attachment).toMatchObject({
      type: 'goal_status',
      met: false,
      sentinel: true,
      condition: 'ship the patch',
    })
  })

  test('addGoalStopHook replaces the previous goal hook instead of stacking goals', () => {
    const harness = createGoalContext()

    addGoalStopHook('first goal', harness.ctx)
    addGoalStopHook('second goal', harness.ctx)

    expect(stopPromptHooks(harness.state, harness.sessionId)).toEqual([
      'second goal',
    ])
    expect(harness.state.activeGoal?.condition).toBe('second goal')
    expect(harness.messages.map(m => (m as any).attachment.condition)).toEqual([
      'first goal',
      'second goal',
    ])
  })

  test('clearGoalStopHook removes goal hook, clears activeGoal, and appends clear sentinel', () => {
    const harness = createGoalContext()
    addGoalStopHook('goal to clear', harness.ctx)

    const prior = clearGoalStopHook(harness.ctx)

    expect(prior).toBe('goal to clear')
    expect(stopPromptHooks(harness.state, harness.sessionId)).toEqual([])
    expect(harness.state.activeGoal).toBeUndefined()
    expect((harness.messages.at(-1) as any).attachment).toMatchObject({
      type: 'goal_status',
      met: true,
      sentinel: true,
      condition: 'goal to clear',
    })
  })

  test('pauseGoalStopHook removes Stop hook but keeps paused activeGoal', () => {
    const harness = createGoalContext()
    addGoalStopHook('pause me', harness.ctx)

    const prior = pauseGoalStopHook(harness.ctx)

    expect(prior).toBe('pause me')
    expect(stopPromptHooks(harness.state, harness.sessionId)).toEqual([])
    expect(harness.state.activeGoal).toMatchObject({
      condition: 'pause me',
      paused: true,
    })
    expect((harness.messages.at(-1) as any).attachment).toMatchObject({
      type: 'goal_status',
      met: false,
      paused: true,
      condition: 'pause me',
    })
  })

  test('resumeGoalStopHook restores Stop hook and unpauses activeGoal', () => {
    const harness = createGoalContext()
    addGoalStopHook('resume me', harness.ctx)
    pauseGoalStopHook(harness.ctx)

    const prior = resumeGoalStopHook(harness.ctx)

    expect(prior).toBe('resume me')
    expect(stopPromptHooks(harness.state, harness.sessionId)).toEqual([
      'resume me',
    ])
    expect(harness.state.activeGoal).toMatchObject({
      condition: 'resume me',
      paused: false,
    })
    expect((harness.messages.at(-1) as any).attachment).toMatchObject({
      type: 'goal_status',
      met: false,
      condition: 'resume me',
    })
  })

  test('clearGoalStopHook returns null without mutating messages when no goal hook exists', () => {
    const harness = createGoalContext()

    expect(clearGoalStopHook(harness.ctx)).toBeNull()
    expect(harness.messages).toEqual([])
    expect(harness.state.activeGoal).toBeUndefined()
  })

  test('restoreGoalFromTranscript re-arms unresolved transcript goal', () => {
    const harness = createGoalContext('restore-session')
    const messages = [
      attachmentMessage({
        type: 'goal_status',
        met: false,
        condition: 'finish restored work',
      }),
    ]

    restoreGoalFromTranscript(
      messages,
      harness.ctx.setAppState,
      harness.sessionId,
    )

    expect(stopPromptHooks(harness.state, harness.sessionId)).toEqual([
      'finish restored work',
    ])
    expect(harness.state.activeGoal).toMatchObject({
      condition: 'finish restored work',
      iterations: 0,
    })
  })

  test('restoreGoalFromTranscript clears stale activeGoal after terminal transcript state', () => {
    const harness = createGoalContext('terminal-session')
    addGoalStopHook('stale goal', harness.ctx)
    const messages = [
      attachmentMessage({
        type: 'goal_status',
        met: false,
        failed: true,
        condition: 'stale goal',
      }),
    ]

    restoreGoalFromTranscript(
      messages,
      harness.ctx.setAppState,
      harness.sessionId,
    )

    expect(harness.state.activeGoal).toBeUndefined()
    expect(stopPromptHooks(harness.state, harness.sessionId)).toEqual([
      'stale goal',
    ])
  })
})

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
  test('paused:true after older active is not restored as a running hook', () => {
    const messages = [
      attachmentMessage({
        type: 'goal_status',
        met: false,
        condition: 'older active',
      }),
      attachmentMessage({
        type: 'goal_status',
        met: false,
        paused: true,
        condition: 'paused goal',
      }),
    ]
    expect(findGoalToRestore(messages)).toBeNull()
  })

  test('restoreGoalFromTranscript restores paused goal without re-arming Stop hook', () => {
    const harness = createGoalContext('paused-restore-session')
    const messages = [
      attachmentMessage({
        type: 'goal_status',
        met: false,
        paused: true,
        condition: 'paused restore',
      }),
    ]

    restoreGoalFromTranscript(
      messages,
      harness.ctx.setAppState,
      harness.sessionId,
    )

    expect(stopPromptHooks(harness.state, harness.sessionId)).toEqual([])
    expect(harness.state.activeGoal).toMatchObject({
      condition: 'paused restore',
      paused: true,
    })
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
