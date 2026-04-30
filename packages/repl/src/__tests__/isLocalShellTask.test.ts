/**
 * Tests for isLocalShellTask — pure type guard for the local_bash
 * task type. Used by stopTask, conversation /clear, and several
 * task-lifecycle paths to discriminate shell tasks from agent /
 * teammate / dream / workflow tasks.
 *
 * Wrong predicate:
 * - non-shell task narrowed as shell → callers access shellCommand
 *   on objects that don't have it (undefined → silent broken
 *   behaviour, not a throw)
 * - shell task incorrectly NOT narrowed → cleanup/abort skipped
 *
 * Locks the same predicate-pattern bug class as isInProcessTeammateTask:
 * the predicate ONLY checks `type` field, NOT the structural fields
 * (command, shellCommand, etc.). Caller's responsibility to ensure
 * tasks are well-formed; the predicate doesn't validate.
 */
import { describe, expect, test } from 'bun:test'
import { isLocalShellTask } from '../localShellTaskGuards.js'

describe('isLocalShellTask — type discrimination', () => {
  test('object with type=local_bash → true', () => {
    expect(
      isLocalShellTask({ type: 'local_bash', command: 'echo hi' }),
    ).toBe(true)
  })

  test('object with type=in_process_teammate → false', () => {
    expect(
      isLocalShellTask({ type: 'in_process_teammate' }),
    ).toBe(false)
  })

  test('object with type=local_agent → false', () => {
    expect(isLocalShellTask({ type: 'local_agent' })).toBe(false)
  })

  test('object with type=remote_agent → false', () => {
    expect(isLocalShellTask({ type: 'remote_agent' })).toBe(false)
  })

  test('object with type=dream → false', () => {
    expect(isLocalShellTask({ type: 'dream' })).toBe(false)
  })
})

describe('isLocalShellTask — non-object inputs', () => {
  test('null → false (no crash)', () => {
    expect(isLocalShellTask(null)).toBe(false)
  })

  test('undefined → false', () => {
    expect(isLocalShellTask(undefined)).toBe(false)
  })

  test('string → false', () => {
    expect(isLocalShellTask('local_bash')).toBe(false)
  })

  test('number → false', () => {
    expect(isLocalShellTask(42)).toBe(false)
  })

  test('boolean → false', () => {
    expect(isLocalShellTask(true)).toBe(false)
  })

  test('array → false (no type field discrimination)', () => {
    // Arrays are objects; first check `'type' in array` is false.
    expect(isLocalShellTask([])).toBe(false)
  })
})

describe('isLocalShellTask — edge case objects', () => {
  test('empty object → false (no type field)', () => {
    expect(isLocalShellTask({})).toBe(false)
  })

  test('object with type but other-than-local_bash → false', () => {
    expect(isLocalShellTask({ type: 'other' })).toBe(false)
  })

  test('object with non-string type → false', () => {
    expect(isLocalShellTask({ type: 42 })).toBe(false)
    expect(isLocalShellTask({ type: null })).toBe(false)
  })

  test('object with type=local_bash but missing command → STILL true (predicate does NOT validate fields)', () => {
    // LOCKED CONTRACT: same shape as isInProcessTeammateTask — only
    // type is checked. Malformed task with type='local_bash' but no
    // command/shellCommand fields passes the predicate. Callers that
    // dereference task.command on the narrowed value would get
    // undefined (not throw), but downstream behaviour is broken.
    expect(isLocalShellTask({ type: 'local_bash' })).toBe(true)
  })
})

describe('isLocalShellTask — return shape', () => {
  test('always returns boolean', () => {
    const samples = [
      { type: 'local_bash' },
      null,
      'string',
      42,
      undefined,
      [],
      {},
    ]
    for (const s of samples) {
      expect(typeof isLocalShellTask(s)).toBe('boolean')
    }
  })

  test('case-sensitive type match', () => {
    expect(isLocalShellTask({ type: 'Local_Bash' })).toBe(false)
    expect(isLocalShellTask({ type: 'LOCAL_BASH' })).toBe(false)
  })
})
