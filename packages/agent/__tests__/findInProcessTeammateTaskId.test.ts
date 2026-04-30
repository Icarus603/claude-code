/**
 * Tests for findInProcessTeammateTaskId — pure helper that locates an
 * in-process teammate's task ID by agent name. The leader uses this
 * to find the task to send messages, update awaitingPlanApproval,
 * etc.
 *
 * Wrong = leader can't find the task → message goes nowhere →
 * silent breakage of teammate coordination.
 *
 * Type-discriminated lookup: only matches tasks where
 * type === 'in_process_teammate' AND identity.agentName === input.
 */
import { describe, expect, test } from 'bun:test'
import { findInProcessTeammateTaskId } from '../inProcessTeammateHelpers.js'

type AppState = Parameters<typeof findInProcessTeammateTaskId>[1]

const buildAppState = (tasks: Record<string, unknown>): AppState =>
  ({ tasks }) as AppState

const teammateTask = (
  id: string,
  agentName: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  type: 'in_process_teammate',
  identity: { agentName, teamName: 'team' },
  ...overrides,
})

describe('findInProcessTeammateTaskId — basic lookup', () => {
  test('matching agent name → task id', () => {
    const r = findInProcessTeammateTaskId(
      'researcher',
      buildAppState({
        t1: teammateTask('t1', 'researcher'),
      }),
    )
    expect(r).toBe('t1')
  })

  test('non-matching agent name → undefined', () => {
    const r = findInProcessTeammateTaskId(
      'unknown',
      buildAppState({
        t1: teammateTask('t1', 'researcher'),
      }),
    )
    expect(r).toBeUndefined()
  })

  test('empty tasks → undefined', () => {
    expect(
      findInProcessTeammateTaskId('researcher', buildAppState({})),
    ).toBeUndefined()
  })
})

describe('findInProcessTeammateTaskId — type discrimination', () => {
  test('non-in-process tasks ignored even if name matches', () => {
    // local_bash with same agentName must NOT match.
    const r = findInProcessTeammateTaskId(
      'researcher',
      buildAppState({
        t1: {
          id: 't1',
          type: 'local_bash',
          identity: { agentName: 'researcher' },
        },
      }),
    )
    expect(r).toBeUndefined()
  })

  test('non-object tasks safely skipped (no crash)', () => {
    expect(() =>
      findInProcessTeammateTaskId(
        'researcher',
        buildAppState({
          t1: null,
          t2: 'string',
          t3: 42,
        }),
      ),
    ).not.toThrow()
  })

  test('task with type=in_process_teammate but missing identity → THROWS', () => {
    // LOCKED bug: isInProcessTeammateTask only checks `type`, not
    // identity shape. So a malformed task passes the predicate, then
    // `task.identity.agentName` throws TypeError.
    //
    // Caller's responsibility to ensure tasks are well-formed; the
    // predicate could be tightened to check identity too, but that's
    // a separate change. This test locks the current behaviour so a
    // refactor doesn't silently change crash → undefined-return.
    expect(() =>
      findInProcessTeammateTaskId(
        'researcher',
        buildAppState({
          t1: {
            id: 't1',
            type: 'in_process_teammate',
            // No identity field
          },
        }),
      ),
    ).toThrow(TypeError)
  })
})

describe('findInProcessTeammateTaskId — multiple tasks', () => {
  test('returns first matching task in iteration order', () => {
    // Object.values iterates insertion order; the helper returns the
    // first match.
    const r = findInProcessTeammateTaskId(
      'researcher',
      buildAppState({
        t1: teammateTask('t1', 'other'),
        t2: teammateTask('t2', 'researcher'),
        t3: teammateTask('t3', 'researcher'), // duplicate name (shouldn't happen, but lock behaviour)
      }),
    )
    expect(r).toBe('t2')
  })

  test('mixed task types: only in-process teammate counted', () => {
    const r = findInProcessTeammateTaskId(
      'researcher',
      buildAppState({
        t1: { id: 't1', type: 'local_bash', identity: { agentName: 'researcher' } },
        t2: teammateTask('t2', 'other'),
        t3: teammateTask('t3', 'researcher'),
      }),
    )
    expect(r).toBe('t3')
  })
})

describe('findInProcessTeammateTaskId — edge cases', () => {
  test('case-sensitive agent name match', () => {
    const r = findInProcessTeammateTaskId(
      'Researcher',
      buildAppState({
        t1: teammateTask('t1', 'researcher'),
      }),
    )
    expect(r).toBeUndefined()
  })

  test('empty agent name → only matches empty-name task', () => {
    expect(
      findInProcessTeammateTaskId(
        '',
        buildAppState({
          t1: teammateTask('t1', 'researcher'),
        }),
      ),
    ).toBeUndefined()
    expect(
      findInProcessTeammateTaskId(
        '',
        buildAppState({
          t1: teammateTask('t1', ''),
        }),
      ),
    ).toBe('t1')
  })

  test('whitespace in agent name treated as part of name', () => {
    expect(
      findInProcessTeammateTaskId(
        'researcher ',
        buildAppState({
          t1: teammateTask('t1', 'researcher'),
        }),
      ),
    ).toBeUndefined()
  })
})
