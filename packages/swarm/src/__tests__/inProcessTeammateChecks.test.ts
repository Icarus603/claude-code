/**
 * Tests for hasActiveInProcessTeammates + hasWorkingInProcessTeammates
 * + isTeamLead — pure AppState predicates that gate session shutdown
 * + leader detection.
 *
 * Wrong shutdown gate = headless/print mode exits while teammates
 * are still processing (data loss). Wrong working check = leader
 * sends shutdown_request before teammate finishes its turn (silent
 * loss of in-flight work).
 *
 * isTeamLead has subtle backward-compat: original sessions that
 * created the team before agent IDs existed have NO agentId, so
 * they're treated as lead. New sessions match by exact agentId.
 */
import { describe, expect, test } from 'bun:test'
import {
  hasActiveInProcessTeammates,
  hasWorkingInProcessTeammates,
  isTeamLead,
} from '../teammateState.js'

const buildAppState = (tasks: Record<string, unknown>) =>
  ({ tasks }) as never

const teammateTask = (overrides: Record<string, unknown>) => ({
  type: 'in_process_teammate',
  ...overrides,
})

describe('hasActiveInProcessTeammates', () => {
  test('empty tasks → false', () => {
    expect(hasActiveInProcessTeammates(buildAppState({}))).toBe(false)
  })

  test('only non-teammate tasks → false', () => {
    expect(
      hasActiveInProcessTeammates(
        buildAppState({
          t1: { type: 'local_bash', status: 'running' },
          t2: { type: 'local_agent', status: 'running' },
        }),
      ),
    ).toBe(false)
  })

  test('idle teammate task → false (only running counted)', () => {
    expect(
      hasActiveInProcessTeammates(
        buildAppState({
          t1: teammateTask({ status: 'idle' }),
        }),
      ),
    ).toBe(false)
  })

  test('completed teammate task → false', () => {
    expect(
      hasActiveInProcessTeammates(
        buildAppState({
          t1: teammateTask({ status: 'completed' }),
        }),
      ),
    ).toBe(false)
  })

  test('1 running teammate → true', () => {
    expect(
      hasActiveInProcessTeammates(
        buildAppState({
          t1: teammateTask({ status: 'running' }),
        }),
      ),
    ).toBe(true)
  })

  test('mix of states: at least one running → true', () => {
    expect(
      hasActiveInProcessTeammates(
        buildAppState({
          t1: teammateTask({ status: 'idle' }),
          t2: teammateTask({ status: 'running' }),
          t3: teammateTask({ status: 'completed' }),
        }),
      ),
    ).toBe(true)
  })
})

describe('hasWorkingInProcessTeammates', () => {
  test('empty tasks → false', () => {
    expect(hasWorkingInProcessTeammates(buildAppState({}))).toBe(false)
  })

  test('running + isIdle=true → false (running but idle = not working)', () => {
    expect(
      hasWorkingInProcessTeammates(
        buildAppState({
          t1: teammateTask({ status: 'running', isIdle: true }),
        }),
      ),
    ).toBe(false)
  })

  test('running + isIdle=false → true', () => {
    expect(
      hasWorkingInProcessTeammates(
        buildAppState({
          t1: teammateTask({ status: 'running', isIdle: false }),
        }),
      ),
    ).toBe(true)
  })

  test('not running → false regardless of isIdle', () => {
    expect(
      hasWorkingInProcessTeammates(
        buildAppState({
          t1: teammateTask({ status: 'idle', isIdle: false }),
        }),
      ),
    ).toBe(false)
  })

  test('multiple teammates: at least one running+!isIdle → true', () => {
    expect(
      hasWorkingInProcessTeammates(
        buildAppState({
          t1: teammateTask({ status: 'running', isIdle: true }),
          t2: teammateTask({ status: 'running', isIdle: false }),
        }),
      ),
    ).toBe(true)
  })

  test('hasWorking is STRICTER than hasActive: working → active, but not vice versa', () => {
    // running+isIdle=true: hasActive=true, hasWorking=false
    const idleRunning = buildAppState({
      t1: teammateTask({ status: 'running', isIdle: true }),
    })
    expect(hasActiveInProcessTeammates(idleRunning)).toBe(true)
    expect(hasWorkingInProcessTeammates(idleRunning)).toBe(false)
  })
})

describe('isTeamLead', () => {
  test('undefined teamContext → false', () => {
    expect(isTeamLead(undefined)).toBe(false)
  })

  test('teamContext without leadAgentId → false', () => {
    expect(isTeamLead({} as unknown as { leadAgentId: string })).toBe(false)
  })

  test('teamContext with leadAgentId, no AsyncLocalStorage agent → true (backward compat)', () => {
    // Documented contract: "no agent ID set" = original session that
    // created the team before agent IDs existed → treated as lead.
    expect(isTeamLead({ leadAgentId: 'lead-id' })).toBe(true)
  })

  test('returns boolean (never undefined)', () => {
    expect(typeof isTeamLead(undefined)).toBe('boolean')
    expect(typeof isTeamLead({ leadAgentId: 'x' })).toBe('boolean')
    expect(
      typeof isTeamLead({} as unknown as { leadAgentId: string }),
    ).toBe('boolean')
  })
})

describe('predicates: type discrimination', () => {
  test('only checks tasks with type="in_process_teammate"', () => {
    // local_bash with status=running should NOT count.
    const r = hasActiveInProcessTeammates(
      buildAppState({
        t1: { type: 'local_bash', status: 'running', isIdle: false },
        t2: { type: 'local_agent', status: 'running' },
        t3: { type: 'in_process_teammate', status: 'idle' },
      }),
    )
    expect(r).toBe(false)
  })
})
