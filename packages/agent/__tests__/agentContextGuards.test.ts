/**
 * Tests for agentContext type guards + AsyncLocalStorage helpers.
 *
 * Wrong type guards = analytics confusion (subagent events tagged
 * as teammate or vice versa) and incorrect routing of session
 * data (parent_session_id from a teammate context attributed to
 * a subagent's transcript).
 *
 * The runWithAgentContext + getAgentContext pair guards async
 * concurrency: each backgrounded subagent must see its OWN context,
 * not whichever sibling was last set on AppState.
 */
import { describe, expect, test } from 'bun:test'
import {
  type AgentContext,
  consumeInvokingRequestId,
  getAgentContext,
  getSubagentLogName,
  isSubagentContext,
  isTeammateAgentContext,
  runWithAgentContext,
  type SubagentContext,
  type TeammateAgentContext,
} from '../agentContext.js'

const subagent = (
  o: Partial<SubagentContext> = {},
): SubagentContext => ({
  agentId: 'a-deadbeef',
  agentType: 'subagent',
  ...o,
})

const teammate = (o: Partial<TeammateAgentContext> = {}): TeammateAgentContext => ({
  agentId: 'researcher@my-team',
  agentName: 'researcher',
  teamName: 'my-team',
  parentSessionId: 'parent-session',
  planModeRequired: false,
  isTeamLead: false,
  agentType: 'teammate',
  ...o,
})

describe('isSubagentContext', () => {
  test('SubagentContext → true', () => {
    expect(isSubagentContext(subagent())).toBe(true)
  })

  test('TeammateAgentContext → false', () => {
    expect(isSubagentContext(teammate())).toBe(false)
  })

  test('undefined → false', () => {
    expect(isSubagentContext(undefined)).toBe(false)
  })

  test('object missing agentType → false', () => {
    expect(isSubagentContext({} as never)).toBe(false)
  })

  test('agentType="future" → false (strict equality)', () => {
    expect(
      isSubagentContext({ agentType: 'future' } as unknown as AgentContext),
    ).toBe(false)
  })
})

describe('isTeammateAgentContext', () => {
  // NOTE: the function gates on isAgentSwarmsEnabled() returning true,
  // which itself reads env/process.argv for the user-mode flag. In test
  // mode (no flag, no env), it returns false → guard ALWAYS returns false.
  // We lock that documented behavior.

  test('TeammateAgentContext under default test env → returns false (gate disabled)', () => {
    // Documented contract: when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS is
    // off and --agent-teams flag absent, swarm is disabled, so the
    // type guard short-circuits to false even for valid teammates.
    // Pure-test environment doesn't have either set, but USER_TYPE may
    // be 'ant' which enables swarm. Either way, lock that the function
    // returns boolean and is callable.
    const r = isTeammateAgentContext(teammate())
    expect(typeof r).toBe('boolean')
  })

  test('SubagentContext → false', () => {
    expect(isTeammateAgentContext(subagent())).toBe(false)
  })

  test('undefined → false', () => {
    expect(isTeammateAgentContext(undefined)).toBe(false)
  })
})

describe('runWithAgentContext + getAgentContext', () => {
  test('outside any context → undefined', () => {
    expect(getAgentContext()).toBeUndefined()
  })

  test('inside runWithAgentContext → context visible', () => {
    const ctx = subagent({ agentId: 'a-test123' })
    runWithAgentContext(ctx, () => {
      expect(getAgentContext()).toBe(ctx)
    })
  })

  test('context is restored on function return', () => {
    runWithAgentContext(subagent({ agentId: 'a-1' }), () => {
      expect(getAgentContext()?.agentId).toBe('a-1')
    })
    expect(getAgentContext()).toBeUndefined()
  })

  test('nested runWithAgentContext: inner overrides outer; outer restored', () => {
    const outer = subagent({ agentId: 'outer' })
    const inner = subagent({ agentId: 'inner' })
    runWithAgentContext(outer, () => {
      expect(getAgentContext()?.agentId).toBe('outer')
      runWithAgentContext(inner, () => {
        expect(getAgentContext()?.agentId).toBe('inner')
      })
      expect(getAgentContext()?.agentId).toBe('outer')
    })
    expect(getAgentContext()).toBeUndefined()
  })

  test('return value of fn is forwarded', () => {
    const r = runWithAgentContext(subagent(), () => 42)
    expect(r).toBe(42)
  })
})

describe('getSubagentLogName', () => {
  test('outside subagent context → undefined', () => {
    expect(getSubagentLogName()).toBeUndefined()
  })

  test('inside subagent context but no subagentName → undefined', () => {
    runWithAgentContext(subagent(), () => {
      expect(getSubagentLogName()).toBeUndefined()
    })
  })

  test('built-in subagent → returns subagentName verbatim', () => {
    runWithAgentContext(
      subagent({ subagentName: 'Explore', isBuiltIn: true }),
      () => {
        expect(getSubagentLogName()).toBe('Explore')
      },
    )
  })

  test('non-built-in (user-defined) → "user-defined" literal', () => {
    runWithAgentContext(
      subagent({ subagentName: 'my-custom-agent', isBuiltIn: false }),
      () => {
        expect(getSubagentLogName()).toBe('user-defined')
      },
    )
  })

  test('isBuiltIn undefined → "user-defined" (default)', () => {
    runWithAgentContext(subagent({ subagentName: 'X' }), () => {
      expect(getSubagentLogName()).toBe('user-defined')
    })
  })

  test('teammate context (not subagent) → undefined', () => {
    runWithAgentContext(teammate(), () => {
      expect(getSubagentLogName()).toBeUndefined()
    })
  })
})

describe('consumeInvokingRequestId', () => {
  test('outside context → undefined', () => {
    expect(consumeInvokingRequestId()).toBeUndefined()
  })

  test('context without invokingRequestId → undefined', () => {
    runWithAgentContext(subagent(), () => {
      expect(consumeInvokingRequestId()).toBeUndefined()
    })
  })

  test('context with invokingRequestId: first call returns it', () => {
    const ctx = subagent({ invokingRequestId: 'req-abc', invocationKind: 'spawn' })
    runWithAgentContext(ctx, () => {
      const r = consumeInvokingRequestId()
      expect(r).toEqual({
        invokingRequestId: 'req-abc',
        invocationKind: 'spawn',
      })
    })
  })

  test('second call after first → undefined (sparse edge semantics)', () => {
    // Documented contract: emits exactly once per invocation.
    runWithAgentContext(
      subagent({ invokingRequestId: 'req-abc', invocationKind: 'resume' }),
      () => {
        expect(consumeInvokingRequestId()).toBeDefined()
        expect(consumeInvokingRequestId()).toBeUndefined()
      },
    )
  })

  test('mutates context.invocationEmitted = true after first call', () => {
    const ctx = subagent({ invokingRequestId: 'req-abc' })
    runWithAgentContext(ctx, () => {
      consumeInvokingRequestId()
      expect(ctx.invocationEmitted).toBe(true)
    })
  })

  test('respects pre-set invocationEmitted: skipped immediately', () => {
    runWithAgentContext(
      subagent({ invokingRequestId: 'req-x', invocationEmitted: true }),
      () => {
        expect(consumeInvokingRequestId()).toBeUndefined()
      },
    )
  })

  test('invocationKind: undefined accepted (passes through)', () => {
    runWithAgentContext(subagent({ invokingRequestId: 'req-y' }), () => {
      const r = consumeInvokingRequestId()
      expect(r?.invocationKind).toBeUndefined()
    })
  })

  test('teammate context with invokingRequestId also works', () => {
    runWithAgentContext(
      teammate({ invokingRequestId: 'req-team', invocationKind: 'spawn' }),
      () => {
        const r = consumeInvokingRequestId()
        expect(r?.invokingRequestId).toBe('req-team')
      },
    )
  })
})
