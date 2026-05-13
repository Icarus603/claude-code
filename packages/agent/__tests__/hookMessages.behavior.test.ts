import { describe, expect, test } from 'bun:test'

import {
  getPreToolHookBlockingMessage,
  getStopHookMessage,
  getTeammateIdleHookMessage,
  getTaskCreatedHookMessage,
  getTaskCompletedHookMessage,
  getUserPromptSubmitHookBlockingMessage,
} from '../hooks.js'

/**
 * Pin the exact wire format of hook-feedback messages. These strings are
 * what gets surfaced TO THE MODEL as system reminders / user-role messages
 * when hooks block. The model uses the prefix ("Stop hook feedback:" etc.)
 * to know it's looking at a hook-blocking response vs a tool result, so
 * the prefix string is part of the contract.
 *
 * Wrong format → model treats the hook output as regular tool result and
 * may continue executing instead of waiting for hook re-evaluation.
 */
describe('Hook feedback formatting (vs ant hook-message contract)', () => {
  const sampleError = { blockingError: 'do not commit secrets to git' }

  test('PreToolUse: "<hookName> hook error: <message>"', () => {
    expect(getPreToolHookBlockingMessage('Bash', sampleError)).toBe(
      'Bash hook error: do not commit secrets to git',
    )
  })

  test('Stop: "Stop hook feedback:\\n<message>"', () => {
    expect(getStopHookMessage(sampleError)).toBe(
      'Stop hook feedback:\ndo not commit secrets to git',
    )
  })

  test('TeammateIdle: "TeammateIdle hook feedback:\\n<message>"', () => {
    expect(getTeammateIdleHookMessage(sampleError)).toBe(
      'TeammateIdle hook feedback:\ndo not commit secrets to git',
    )
  })

  test('TaskCreated: "TaskCreated hook feedback:\\n<message>"', () => {
    expect(getTaskCreatedHookMessage(sampleError)).toBe(
      'TaskCreated hook feedback:\ndo not commit secrets to git',
    )
  })

  test('TaskCompleted: "TaskCompleted hook feedback:\\n<message>"', () => {
    expect(getTaskCompletedHookMessage(sampleError)).toBe(
      'TaskCompleted hook feedback:\ndo not commit secrets to git',
    )
  })

  test('UserPromptSubmit: "UserPromptSubmit operation blocked by hook:\\n<message>"', () => {
    expect(getUserPromptSubmitHookBlockingMessage(sampleError)).toBe(
      'UserPromptSubmit operation blocked by hook:\ndo not commit secrets to git',
    )
  })

  test('preserves multi-line blocking errors verbatim', () => {
    const multilineError = {
      blockingError: 'line 1\nline 2\nline 3',
    }
    const result = getStopHookMessage(multilineError)
    expect(result).toBe('Stop hook feedback:\nline 1\nline 2\nline 3')
  })

  test('empty blocking error renders cleanly (no trailing colon, no crash)', () => {
    expect(getStopHookMessage({ blockingError: '' })).toBe('Stop hook feedback:\n')
  })
})
