import { describe, expect, test } from 'bun:test'
import { getInteractiveMcpClients } from '../screens/repl/integrations.js'
import { getViewedLocalAgentTask } from '../screens/repl/backgrounding.js'

describe('getInteractiveMcpClients', () => {
  // Critical contract: in remote sessions, MCP clients are NOT shown
  // in the interactive picker — even if some clients are connected.
  // This is an intentional UX decision (remote sessions can't safely
  // hand over MCP control to the user).

  test('returns empty array when isRemoteSession=true (regardless of clients)', () => {
    const result = getInteractiveMcpClients(true, [
      { name: 'a' } as never,
      { name: 'b' } as never,
    ])
    expect(result).toEqual([])
  })

  test('returns empty array when isRemoteSession=true and mcpClients is undefined', () => {
    expect(getInteractiveMcpClients(true, undefined)).toEqual([])
  })

  test('returns the clients array when isRemoteSession=false', () => {
    const clients = [{ name: 'a' } as never]
    expect(getInteractiveMcpClients(false, clients)).toBe(clients)
  })

  test('returns empty array (NOT undefined) when not remote and clients is undefined', () => {
    // Contract: callers iterate without null-check, so we must always
    // return an array. The shared EMPTY_MCP_CLIENTS reference avoids
    // allocating a new array on every call.
    const result = getInteractiveMcpClients(false, undefined)
    expect(result).toEqual([])
    expect(Array.isArray(result)).toBe(true)
  })

  test('shared EMPTY_MCP_CLIENTS — same reference across calls', () => {
    // Performance contract: the empty result is a singleton. Verifies
    // no per-call allocation when both fast paths return empty.
    const a = getInteractiveMcpClients(true, [{ name: 'x' } as never])
    const b = getInteractiveMcpClients(true, undefined)
    const c = getInteractiveMcpClients(false, undefined)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })
})

describe('getViewedLocalAgentTask', () => {
  test('returns undefined when viewingAgentTaskId is undefined', () => {
    expect(getViewedLocalAgentTask({ a: 'x' }, undefined)).toBeUndefined()
  })

  test('returns the task when id matches a key', () => {
    expect(getViewedLocalAgentTask({ a: 'x', b: 'y' }, 'a')).toBe('x')
  })

  test('returns undefined when id does not match any key', () => {
    expect(getViewedLocalAgentTask({ a: 'x' }, 'missing')).toBeUndefined()
  })

  test('handles empty tasks record', () => {
    expect(getViewedLocalAgentTask({}, 'any')).toBeUndefined()
  })

  test('preserves the task value type (generic-correct)', () => {
    type Task = { id: string; status: 'running' | 'done' }
    const tasks: Record<string, Task> = {
      t1: { id: 't1', status: 'running' },
    }
    const result = getViewedLocalAgentTask(tasks, 't1')
    expect(result?.status).toBe('running')
  })

  test('empty-string viewingAgentTaskId is falsy → returns undefined', () => {
    // The `viewingAgentTaskId ? ... : undefined` ternary treats '' as
    // falsy. Documents this — empty string ID is treated as "not viewing".
    expect(getViewedLocalAgentTask({ '': 'value' } as never, '')).toBeUndefined()
  })
})
