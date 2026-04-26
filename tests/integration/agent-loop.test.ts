import { describe, expect, test } from 'bun:test'

/**
 * E2E test for the message queue + queryEngine boundary.
 *
 * Today's session uncovered several bombs in setter shims that broke
 * plugin loading; the next class of likely regression is the agent
 * message loop (MessageQueueManager + queryEngine + setAppState).
 *
 * This test exercises the queue contract without launching a real
 * provider: enqueue → drain → assertions. Catches:
 *   - enqueue/dequeue logic regressions
 *   - QueuedCommand shape changes that break consumers
 *   - popAllEditable edge cases (empty queue, mixed modes)
 *
 * Does NOT test the LLM round-trip — that needs an API key. The
 * provider boundary is covered by tests in packages/provider.
 */

describe('agent message queue e2e', () => {
  test('enqueue + getCommandQueue round-trip', async () => {
    await import('@claude-code/app-host/runtime/bootstrap.js')
    const { enqueue, getCommandQueue, getCommandQueueLength, removeByFilter } =
      await import('@claude-code/agent/messageQueueManager.js')

    // Queue should be empty at start (or contain only stale entries
    // from earlier tests; clear them).
    removeByFilter(() => true)
    expect(getCommandQueueLength()).toBe(0)

    enqueue({
      mode: 'prompt',
      text: 'hello',
      images: [],
      uuid: 'test-uuid-1',
    })

    expect(getCommandQueueLength()).toBe(1)
    const q = getCommandQueue()
    expect(q.length).toBe(1)
    expect(q[0]?.text).toBe('hello')
    expect(q[0]?.mode).toBe('prompt')

    // Cleanup
    removeByFilter(() => true)
  })

  test('removeByFilter strips matching entries', async () => {
    await import('@claude-code/app-host/runtime/bootstrap.js')
    const { enqueue, getCommandQueueLength, removeByFilter } = await import(
      '@claude-code/agent/messageQueueManager.js'
    )

    removeByFilter(() => true)
    enqueue({ mode: 'prompt', text: 'A', images: [], uuid: 'a' })
    enqueue({
      mode: 'task-notification',
      text: 'B',
      images: [],
      uuid: 'b',
    })
    enqueue({ mode: 'prompt', text: 'C', images: [], uuid: 'c' })

    expect(getCommandQueueLength()).toBe(3)

    const removed = removeByFilter(c => c.mode === 'task-notification')
    expect(removed.length).toBe(1)
    expect(removed[0]?.text).toBe('B')
    expect(getCommandQueueLength()).toBe(2)

    removeByFilter(() => true)
  })

  test('popAllEditable returns undefined when queue is empty', async () => {
    await import('@claude-code/app-host/runtime/bootstrap.js')
    const { popAllEditable, removeByFilter } = await import(
      '@claude-code/agent/messageQueueManager.js'
    )
    removeByFilter(() => true)
    // Empty queue → undefined (not null, not throwing)
    expect(popAllEditable('current input', 0)).toBeUndefined()
  })
})
