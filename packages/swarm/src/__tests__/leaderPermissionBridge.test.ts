import { afterEach, describe, expect, test } from 'bun:test'
import {
  getLeaderSetToolPermissionContext,
  getLeaderToolUseConfirmQueue,
  registerLeaderSetToolPermissionContext,
  registerLeaderToolUseConfirmQueue,
  unregisterLeaderSetToolPermissionContext,
  unregisterLeaderToolUseConfirmQueue,
} from '../permissions/leaderPermissionBridge.js'

afterEach(() => {
  // Tests share module-level state — clean up after each to avoid leaking
  // a stale registration into the next test.
  unregisterLeaderToolUseConfirmQueue()
  unregisterLeaderSetToolPermissionContext()
})

describe('Leader ToolUseConfirmQueue bridge', () => {
  test('returns null when nothing is registered', () => {
    expect(getLeaderToolUseConfirmQueue()).toBeNull()
  })

  test('register → getter returns the registered fn', () => {
    const fn = (_u: (prev: unknown[]) => unknown[]) => undefined
    registerLeaderToolUseConfirmQueue(fn as never)
    expect(getLeaderToolUseConfirmQueue()).toBe(fn as never)
  })

  test('unregister → getter returns null again', () => {
    registerLeaderToolUseConfirmQueue((() => undefined) as never)
    unregisterLeaderToolUseConfirmQueue()
    expect(getLeaderToolUseConfirmQueue()).toBeNull()
  })

  test('register replaces a previous registration (last-write-wins)', () => {
    // The REPL re-registers on every mount of the leader. Without
    // last-write-wins, a re-registration would leave a stale closure
    // referencing a torn-down React tree → silent no-op or "setState on
    // unmounted component" warnings.
    const first = (() => undefined) as never
    const second = (() => undefined) as never
    registerLeaderToolUseConfirmQueue(first)
    registerLeaderToolUseConfirmQueue(second)
    expect(getLeaderToolUseConfirmQueue()).toBe(second)
  })

  test('getter returns SAME reference across multiple calls (no copy)', () => {
    // The getter is consulted on the hot path (every in-process teammate
    // permission request). It must not allocate a new wrapper each call.
    const fn = (() => undefined) as never
    registerLeaderToolUseConfirmQueue(fn)
    expect(getLeaderToolUseConfirmQueue()).toBe(getLeaderToolUseConfirmQueue())
  })
})

describe('Leader ToolPermissionContext bridge', () => {
  test('returns null when nothing is registered', () => {
    expect(getLeaderSetToolPermissionContext()).toBeNull()
  })

  test('register → getter returns the registered fn', () => {
    const fn = (_ctx: unknown, _opts?: { preserveMode?: boolean }) => undefined
    registerLeaderSetToolPermissionContext(fn as never)
    expect(getLeaderSetToolPermissionContext()).toBe(fn as never)
  })

  test('unregister → getter returns null again', () => {
    registerLeaderSetToolPermissionContext((() => undefined) as never)
    unregisterLeaderSetToolPermissionContext()
    expect(getLeaderSetToolPermissionContext()).toBeNull()
  })

  test('register replaces a previous registration', () => {
    const first = (() => undefined) as never
    const second = (() => undefined) as never
    registerLeaderSetToolPermissionContext(first)
    registerLeaderSetToolPermissionContext(second)
    expect(getLeaderSetToolPermissionContext()).toBe(second)
  })
})

describe('two bridges are INDEPENDENT', () => {
  // CRITICAL: the two slots are separate module-level vars. A bug like
  // accidentally sharing the slot would mean registering one wipes the
  // other. This test pins down the isolation.

  test('registering ToolUseConfirmQueue does NOT affect ToolPermissionContext', () => {
    registerLeaderToolUseConfirmQueue((() => undefined) as never)
    expect(getLeaderSetToolPermissionContext()).toBeNull()
  })

  test('registering ToolPermissionContext does NOT affect ToolUseConfirmQueue', () => {
    registerLeaderSetToolPermissionContext((() => undefined) as never)
    expect(getLeaderToolUseConfirmQueue()).toBeNull()
  })

  test('unregistering one does NOT clear the other', () => {
    const queueFn = (() => undefined) as never
    const ctxFn = (() => undefined) as never
    registerLeaderToolUseConfirmQueue(queueFn)
    registerLeaderSetToolPermissionContext(ctxFn)
    unregisterLeaderToolUseConfirmQueue()
    expect(getLeaderToolUseConfirmQueue()).toBeNull()
    expect(getLeaderSetToolPermissionContext()).toBe(ctxFn)
  })

  test('both can be registered simultaneously', () => {
    const queueFn = (() => undefined) as never
    const ctxFn = (() => undefined) as never
    registerLeaderToolUseConfirmQueue(queueFn)
    registerLeaderSetToolPermissionContext(ctxFn)
    expect(getLeaderToolUseConfirmQueue()).toBe(queueFn)
    expect(getLeaderSetToolPermissionContext()).toBe(ctxFn)
  })
})
