import { describe, expect, test } from 'bun:test'
import {
  createTeammateContext,
  getTeammateContext,
  isInProcessTeammate,
  runWithTeammateContext,
  type TeammateContext,
} from '../teammateContextAlias.js'

function makeCtx(over: Partial<TeammateContext> = {}): TeammateContext {
  return {
    agentId: 'researcher@my-team',
    agentName: 'researcher',
    teamName: 'my-team',
    color: 'blue',
    planModeRequired: false,
    parentSessionId: 'sess-1',
    isInProcess: true,
    abortController: new AbortController(),
    ...over,
  }
}

describe('createTeammateContext — discriminator', () => {
  test('unconditionally sets isInProcess: true (config does NOT need to)', () => {
    const ctx = createTeammateContext({
      agentId: 'a',
      agentName: 'a',
      teamName: 't',
      planModeRequired: false,
      parentSessionId: 's',
      abortController: new AbortController(),
    })
    expect(ctx.isInProcess).toBe(true)
  })

  test('passes through all caller-supplied fields verbatim', () => {
    const ac = new AbortController()
    const ctx = createTeammateContext({
      agentId: 'researcher@team',
      agentName: 'researcher',
      teamName: 'team',
      color: 'cyan',
      planModeRequired: true,
      parentSessionId: 'sess-abc',
      abortController: ac,
    })
    expect(ctx.agentId).toBe('researcher@team')
    expect(ctx.agentName).toBe('researcher')
    expect(ctx.teamName).toBe('team')
    expect(ctx.color).toBe('cyan')
    expect(ctx.planModeRequired).toBe(true)
    expect(ctx.parentSessionId).toBe('sess-abc')
    expect(ctx.abortController).toBe(ac)
  })

  test('color is optional', () => {
    const ctx = createTeammateContext({
      agentId: 'a',
      agentName: 'a',
      teamName: 't',
      planModeRequired: false,
      parentSessionId: 's',
      abortController: new AbortController(),
    })
    expect(ctx.color).toBeUndefined()
  })
})

describe('AsyncLocalStorage scoping — isolation contract', () => {
  // CRITICAL: AsyncLocalStorage must isolate concurrent teammate contexts.
  // Without proper scoping, two teammates running in parallel would see
  // each other's agentId and route messages to the wrong inbox.

  test('outside any run(), getTeammateContext returns undefined', () => {
    expect(getTeammateContext()).toBeUndefined()
  })

  test('outside any run(), isInProcessTeammate returns false', () => {
    expect(isInProcessTeammate()).toBe(false)
  })

  test('runWithTeammateContext exposes ctx synchronously inside callback', () => {
    const ctx = makeCtx()
    runWithTeammateContext(ctx, () => {
      expect(getTeammateContext()).toBe(ctx)
      expect(isInProcessTeammate()).toBe(true)
    })
  })

  test('after run() returns, context is cleared', () => {
    const ctx = makeCtx()
    runWithTeammateContext(ctx, () => {
      expect(getTeammateContext()).toBe(ctx)
    })
    expect(getTeammateContext()).toBeUndefined()
  })

  test('nested run() — inner replaces outer; restored on inner exit', () => {
    const outer = makeCtx({ agentId: 'outer@t', agentName: 'outer' })
    const inner = makeCtx({ agentId: 'inner@t', agentName: 'inner' })
    runWithTeammateContext(outer, () => {
      expect(getTeammateContext()?.agentId).toBe('outer@t')
      runWithTeammateContext(inner, () => {
        expect(getTeammateContext()?.agentId).toBe('inner@t')
      })
      // After inner exits, outer's context is restored.
      expect(getTeammateContext()?.agentId).toBe('outer@t')
    })
  })

  test('runWithTeammateContext returns the callback return value', () => {
    const result = runWithTeammateContext(makeCtx(), () => 42)
    expect(result).toBe(42)
  })

  test('async — context propagates through await', async () => {
    // The whole point of AsyncLocalStorage is that context survives await
    // boundaries. If a future migration to a sync mechanism breaks this,
    // teammates would lose their identity mid-tool-call.
    const ctx = makeCtx({ agentId: 'async@t', agentName: 'async' })
    const captured = await runWithTeammateContext(ctx, async () => {
      await new Promise(r => setTimeout(r, 0))
      return getTeammateContext()?.agentId
    })
    expect(captured).toBe('async@t')
  })

  test('async — concurrent runs do NOT leak into each other', async () => {
    // Spin up two parallel async runs with distinct contexts. Each must
    // see only its own agentId despite executing concurrently. This is
    // the load-bearing isolation property.
    const a = makeCtx({ agentId: 'a@t', agentName: 'a' })
    const b = makeCtx({ agentId: 'b@t', agentName: 'b' })

    const taskA = runWithTeammateContext(a, async () => {
      await new Promise(r => setTimeout(r, 0))
      return getTeammateContext()?.agentId
    })
    const taskB = runWithTeammateContext(b, async () => {
      await new Promise(r => setTimeout(r, 0))
      return getTeammateContext()?.agentId
    })
    const [resA, resB] = await Promise.all([taskA, taskB])
    expect(resA).toBe('a@t')
    expect(resB).toBe('b@t')
  })
})

describe('isInProcessTeammate — performance shortcut', () => {
  // Documented as a "faster than getTeammateContext() !== undefined"
  // shortcut. Verify it returns the correct boolean in the simple cases
  // — anything more would be re-testing the AsyncLocalStorage internals.

  test('returns boolean (not a truthy/falsy value)', () => {
    expect(typeof isInProcessTeammate()).toBe('boolean')
    runWithTeammateContext(makeCtx(), () => {
      expect(typeof isInProcessTeammate()).toBe('boolean')
    })
  })

  test('matches "context !== undefined" semantics inside and outside run', () => {
    expect(isInProcessTeammate()).toBe(getTeammateContext() !== undefined)
    runWithTeammateContext(makeCtx(), () => {
      expect(isInProcessTeammate()).toBe(getTeammateContext() !== undefined)
    })
  })
})
