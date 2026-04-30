/**
 * Tests for isBackgroundTask — pure predicate deciding which tasks
 * appear in the background tasks indicator (footer pill, /bg view).
 *
 * Filter rules:
 *   1. status MUST be 'running' or 'pending' (not 'completed', etc.)
 *   2. If task has isBackgrounded === false → NOT a background task
 *      (foreground task, not yet backgrounded by the user)
 *   3. Tasks without isBackgrounded property are background by default
 *
 * Wrong:
 * - idle/completed tasks show in indicator → UX clutter
 * - active backgrounded work hidden → user can't find their task
 */
import { describe, expect, test } from 'bun:test'
import { isBackgroundTask } from '../tasksTypes.js'

type TaskState = Parameters<typeof isBackgroundTask>[0]

const localShellTask = (
  status: string,
  isBackgrounded?: boolean,
): TaskState =>
  ({
    type: 'local_bash',
    status,
    ...(isBackgrounded !== undefined ? { isBackgrounded } : {}),
  }) as TaskState

const teammateTask = (status: string): TaskState =>
  ({
    type: 'in_process_teammate',
    status,
  }) as TaskState

describe('isBackgroundTask — status filter', () => {
  test('running task → true', () => {
    expect(isBackgroundTask(localShellTask('running'))).toBe(true)
  })

  test('pending task → true', () => {
    expect(isBackgroundTask(localShellTask('pending'))).toBe(true)
  })

  test('completed → false', () => {
    expect(isBackgroundTask(localShellTask('completed'))).toBe(false)
  })

  test('idle → false', () => {
    expect(isBackgroundTask(localShellTask('idle'))).toBe(false)
  })

  test('failed → false', () => {
    expect(isBackgroundTask(localShellTask('failed'))).toBe(false)
  })

  test('killed → false', () => {
    expect(isBackgroundTask(localShellTask('killed'))).toBe(false)
  })
})

describe('isBackgroundTask — isBackgrounded foreground exclusion', () => {
  test('running + isBackgrounded=false → false (foreground task)', () => {
    // Locked: foreground tasks (user hasn't backgrounded them yet)
    // are NOT yet background tasks even if running.
    expect(isBackgroundTask(localShellTask('running', false))).toBe(false)
  })

  test('running + isBackgrounded=true → true', () => {
    expect(isBackgroundTask(localShellTask('running', true))).toBe(true)
  })

  test('pending + isBackgrounded=false → false', () => {
    expect(isBackgroundTask(localShellTask('pending', false))).toBe(false)
  })
})

describe('isBackgroundTask — tasks without isBackgrounded', () => {
  test('teammate task running (no isBackgrounded prop) → true', () => {
    // Tasks lacking isBackgrounded property default to background.
    // Only LocalShellTask has the foreground/background distinction.
    expect(isBackgroundTask(teammateTask('running'))).toBe(true)
  })

  test('teammate task completed → false (status filter)', () => {
    expect(isBackgroundTask(teammateTask('completed'))).toBe(false)
  })
})

describe('isBackgroundTask — return shape', () => {
  test('always returns boolean', () => {
    const samples = [
      localShellTask('running'),
      localShellTask('completed'),
      localShellTask('running', false),
      teammateTask('running'),
    ]
    for (const t of samples) {
      expect(typeof isBackgroundTask(t)).toBe('boolean')
    }
  })
})

describe('isBackgroundTask — locked truth-table', () => {
  test('matrix: status x isBackgrounded → expected outcome', () => {
    type Row = {
      status: string
      isBackgrounded?: boolean
      expected: boolean
    }
    const rows: Row[] = [
      // running
      { status: 'running', expected: true },
      { status: 'running', isBackgrounded: true, expected: true },
      { status: 'running', isBackgrounded: false, expected: false },
      // pending
      { status: 'pending', expected: true },
      { status: 'pending', isBackgrounded: true, expected: true },
      { status: 'pending', isBackgrounded: false, expected: false },
      // terminal statuses
      { status: 'completed', expected: false },
      { status: 'completed', isBackgrounded: true, expected: false },
      { status: 'completed', isBackgrounded: false, expected: false },
      { status: 'failed', expected: false },
      { status: 'killed', expected: false },
    ]
    for (const row of rows) {
      const task = localShellTask(row.status, row.isBackgrounded)
      expect(isBackgroundTask(task)).toBe(row.expected)
    }
  })
})
