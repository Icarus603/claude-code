
import { describe, test, expect } from 'bun:test'
import { createBudgetTracker, checkTokenBudget } from '../internal/tokenBudget.js'

describe('tokenBudget', () => {
  test('createBudgetTracker returns the initial state', () => {
    const tracker = createBudgetTracker()
    expect(tracker.continuationCount).toBe(0)
    expect(tracker.lastDeltaTokens).toBe(0)
    expect(tracker.lastGlobalTurnTokens).toBe(0)
  })

  test('stops immediately when agentId is present', () => {
    const tracker = createBudgetTracker()
    const result = checkTokenBudget(tracker, 'agent-123', 10000, 5000)
    expect(result.action).toBe('stop')
    if (result.action === 'stop') {
      expect(result.completionEvent).toBeNull()
    }
  })

  test('stops immediately when budget is null', () => {
    const tracker = createBudgetTracker()
    const result = checkTokenBudget(tracker, undefined, null, 5000)
    expect(result.action).toBe('stop')
  })

  test('stops immediately when budget is less than or equal to zero', () => {
    const tracker = createBudgetTracker()
    const result = checkTokenBudget(tracker, undefined, 0, 5000)
    expect(result.action).toBe('stop')
  })

  test('continues when usage is below the 90% threshold', () => {
    const tracker = createBudgetTracker()
    const result = checkTokenBudget(tracker, undefined, 10000, 5000)
    expect(result.action).toBe('continue')
    if (result.action === 'continue') {
      expect(result.pct).toBe(50)
      expect(result.nudgeMessage).toContain('50%')
    }
  })

  test('stops when usage reaches the 90% threshold', () => {
    const tracker = createBudgetTracker()
    const result = checkTokenBudget(tracker, undefined, 10000, 9000)
    expect(result.action).toBe('stop')
  })

  test('stops on repeated diminishing returns', () => {
    const tracker = createBudgetTracker()
    checkTokenBudget(tracker, undefined, 10000, 1000) // turn 1
    checkTokenBudget(tracker, undefined, 10000, 1500) // turn 2
    checkTokenBudget(tracker, undefined, 10000, 1800) // turn 3
    const result = checkTokenBudget(tracker, undefined, 10000, 2000)
    expect(result.action).toBe('stop')
    if (result.action === 'stop' && result.completionEvent) {
      expect(result.completionEvent.diminishingReturns).toBe(true)
    }
  })

  test('returns no completionEvent when the first turn already exceeds the threshold', () => {
    const tracker = createBudgetTracker()
    const result = checkTokenBudget(tracker, undefined, 10000, 9500)
    expect(result.action).toBe('stop')
    if (result.action === 'stop') {
      expect(result.completionEvent).toBeNull()
    }
  })
})
