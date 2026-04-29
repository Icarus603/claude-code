/**
 * Tests for Task.ts pure helpers.
 *
 * isTerminalTaskStatus gates message-injection into dead teammates,
 * AppState eviction of finished tasks, and orphan-cleanup paths.
 * A regression here either:
 *   - leaks state (treats a completed task as still running → never
 *     evicted from AppState)
 *   - drops messages (treats a running task as terminal → injection
 *     skipped)
 *
 * generateTaskId uses a per-type prefix + 8-char random alphabet.
 * Wrong prefix = task list display shows tasks under wrong type
 * filter; wrong alphabet = collision risk under high spawn rate.
 */
import { describe, expect, test } from 'bun:test'
import {
  generateTaskId,
  isTerminalTaskStatus,
  type TaskStatus,
  type TaskType,
} from '../Task.js'

describe('isTerminalTaskStatus', () => {
  test('completed → terminal', () => {
    expect(isTerminalTaskStatus('completed')).toBe(true)
  })

  test('failed → terminal', () => {
    expect(isTerminalTaskStatus('failed')).toBe(true)
  })

  test('killed → terminal', () => {
    expect(isTerminalTaskStatus('killed')).toBe(true)
  })

  test('pending → NOT terminal', () => {
    expect(isTerminalTaskStatus('pending')).toBe(false)
  })

  test('running → NOT terminal', () => {
    expect(isTerminalTaskStatus('running')).toBe(false)
  })

  test('unknown / typo → NOT terminal (defense in depth)', () => {
    // The function uses === comparisons; an unknown TaskStatus value
    // doesn't accidentally count as terminal. Documented safety net
    // for type-narrowing escapes.
    expect(isTerminalTaskStatus('paused' as TaskStatus)).toBe(false)
  })
})

describe('generateTaskId — type prefix', () => {
  test('local_bash → b prefix', () => {
    expect(generateTaskId('local_bash')).toMatch(/^b[0-9a-z]{8}$/)
  })

  test('local_agent → a prefix', () => {
    expect(generateTaskId('local_agent')).toMatch(/^a[0-9a-z]{8}$/)
  })

  test('remote_agent → r prefix', () => {
    expect(generateTaskId('remote_agent')).toMatch(/^r[0-9a-z]{8}$/)
  })

  test('in_process_teammate → t prefix', () => {
    expect(generateTaskId('in_process_teammate')).toMatch(/^t[0-9a-z]{8}$/)
  })

  test('local_workflow → w prefix', () => {
    expect(generateTaskId('local_workflow')).toMatch(/^w[0-9a-z]{8}$/)
  })

  test('monitor_mcp → m prefix', () => {
    expect(generateTaskId('monitor_mcp')).toMatch(/^m[0-9a-z]{8}$/)
  })

  test('dream → d prefix', () => {
    expect(generateTaskId('dream')).toMatch(/^d[0-9a-z]{8}$/)
  })

  test('unknown TaskType → x prefix (fallback)', () => {
    // Documented: TASK_ID_PREFIXES[type] ?? 'x' — a typo in the union
    // produces an x-prefixed ID rather than throwing.
    expect(generateTaskId('unknown' as TaskType)).toMatch(/^x[0-9a-z]{8}$/)
  })
})

describe('generateTaskId — alphabet + uniqueness', () => {
  test('all chars after prefix are in [0-9a-z]', () => {
    const id = generateTaskId('local_bash')
    expect(id.slice(1)).toMatch(/^[0-9a-z]{8}$/)
  })

  test('100 generated IDs are all unique (collision check)', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateTaskId('local_bash'))
    }
    expect(ids.size).toBe(100)
  })

  test('no uppercase letters in random portion', () => {
    // Documented: case-insensitive-safe alphabet (digits + lowercase)
    // — symlink-attack mitigation. Lock that uppercase never appears.
    for (let i = 0; i < 30; i++) {
      const id = generateTaskId('local_bash').slice(1)
      expect(id).toBe(id.toLowerCase())
    }
  })

  test('total length = 1 prefix + 8 random = 9', () => {
    expect(generateTaskId('local_bash').length).toBe(9)
  })

  test('IDs across different types do not collide', () => {
    // Different prefixes mean different namespaces.
    const types: TaskType[] = [
      'local_bash',
      'local_agent',
      'remote_agent',
      'in_process_teammate',
    ]
    const ids = types.map(t => generateTaskId(t))
    expect(new Set(ids).size).toBe(types.length)
  })
})
