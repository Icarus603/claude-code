import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  clearPostSamplingHooks,
  executePostSamplingHooks,
  registerPostSamplingHook,
} from '../postSamplingHooks.js'

afterEach(() => {
  clearPostSamplingHooks()
})

const FAKE_CONTEXT = {
  messages: [],
  systemPrompt: '' as never,
  userContext: {},
  systemContext: {},
  toolUseContext: {} as never,
}

describe('registerPostSamplingHook + executePostSamplingHooks', () => {
  test('a registered hook is called once per executePostSamplingHooks', async () => {
    const hook = mock(async () => {})
    registerPostSamplingHook(hook)
    await executePostSamplingHooks(
      FAKE_CONTEXT.messages,
      FAKE_CONTEXT.systemPrompt,
      FAKE_CONTEXT.userContext,
      FAKE_CONTEXT.systemContext,
      FAKE_CONTEXT.toolUseContext,
    )
    expect(hook).toHaveBeenCalledTimes(1)
  })

  test('multiple registered hooks are called in registration order', async () => {
    const order: string[] = []
    registerPostSamplingHook(async () => {
      order.push('a')
    })
    registerPostSamplingHook(async () => {
      order.push('b')
    })
    registerPostSamplingHook(async () => {
      order.push('c')
    })
    await executePostSamplingHooks(
      FAKE_CONTEXT.messages,
      FAKE_CONTEXT.systemPrompt,
      FAKE_CONTEXT.userContext,
      FAKE_CONTEXT.systemContext,
      FAKE_CONTEXT.toolUseContext,
    )
    expect(order).toEqual(['a', 'b', 'c'])
  })

  test('synchronous hooks are awaited correctly', async () => {
    let called = false
    registerPostSamplingHook(() => {
      called = true
    })
    await executePostSamplingHooks(
      FAKE_CONTEXT.messages,
      FAKE_CONTEXT.systemPrompt,
      FAKE_CONTEXT.userContext,
      FAKE_CONTEXT.systemContext,
      FAKE_CONTEXT.toolUseContext,
    )
    expect(called).toBe(true)
  })

  test('hook receives the full REPLHookContext', async () => {
    const context = {
      messages: [{ id: 'msg1' }] as never,
      systemPrompt: 'sysprompt' as never,
      userContext: { foo: 'bar' },
      systemContext: { env: 'test' },
      toolUseContext: { tool: 'something' } as never,
      querySource: 'main' as never,
    }
    const captured: unknown[] = []
    registerPostSamplingHook(async ctx => {
      captured.push(ctx)
    })
    await executePostSamplingHooks(
      context.messages,
      context.systemPrompt,
      context.userContext,
      context.systemContext,
      context.toolUseContext,
      context.querySource,
    )
    expect(captured).toHaveLength(1)
    expect(captured[0]).toEqual(context)
  })

  test('querySource is optional and defaults to undefined', async () => {
    let captured: unknown = null
    registerPostSamplingHook(async ctx => {
      captured = ctx
    })
    await executePostSamplingHooks(
      FAKE_CONTEXT.messages,
      FAKE_CONTEXT.systemPrompt,
      FAKE_CONTEXT.userContext,
      FAKE_CONTEXT.systemContext,
      FAKE_CONTEXT.toolUseContext,
    )
    expect((captured as { querySource: unknown }).querySource).toBeUndefined()
  })
})

describe('clearPostSamplingHooks', () => {
  test('removes all registered hooks', async () => {
    const hook = mock(async () => {})
    registerPostSamplingHook(hook)
    clearPostSamplingHooks()
    await executePostSamplingHooks(
      FAKE_CONTEXT.messages,
      FAKE_CONTEXT.systemPrompt,
      FAKE_CONTEXT.userContext,
      FAKE_CONTEXT.systemContext,
      FAKE_CONTEXT.toolUseContext,
    )
    expect(hook).not.toHaveBeenCalled()
  })

  test('resets registration count to 0', async () => {
    registerPostSamplingHook(async () => {})
    registerPostSamplingHook(async () => {})
    registerPostSamplingHook(async () => {})
    clearPostSamplingHooks()
    let calls = 0
    registerPostSamplingHook(async () => {
      calls++
    })
    await executePostSamplingHooks(
      FAKE_CONTEXT.messages,
      FAKE_CONTEXT.systemPrompt,
      FAKE_CONTEXT.userContext,
      FAKE_CONTEXT.systemContext,
      FAKE_CONTEXT.toolUseContext,
    )
    // Only the post-clear hook ran — pre-clear ones are gone.
    expect(calls).toBe(1)
  })
})

describe('error handling — hook failures must not propagate', () => {
  // Critical contract: post-sampling hooks are advisory; one failing hook
  // must NOT abort the rest of the chain or fail the agent's turn.
  // Without this, a single broken plugin could brick a session.

  test('a throwing hook does not stop subsequent hooks from running', async () => {
    const order: string[] = []
    registerPostSamplingHook(async () => {
      order.push('a')
    })
    registerPostSamplingHook(async () => {
      order.push('b')
      throw new Error('hook-b-failed')
    })
    registerPostSamplingHook(async () => {
      order.push('c')
    })
    await executePostSamplingHooks(
      FAKE_CONTEXT.messages,
      FAKE_CONTEXT.systemPrompt,
      FAKE_CONTEXT.userContext,
      FAKE_CONTEXT.systemContext,
      FAKE_CONTEXT.toolUseContext,
    )
    expect(order).toEqual(['a', 'b', 'c'])
  })

  test('synchronously thrown error is also caught', async () => {
    let later = false
    registerPostSamplingHook(() => {
      throw new Error('sync-throw')
    })
    registerPostSamplingHook(async () => {
      later = true
    })
    await executePostSamplingHooks(
      FAKE_CONTEXT.messages,
      FAKE_CONTEXT.systemPrompt,
      FAKE_CONTEXT.userContext,
      FAKE_CONTEXT.systemContext,
      FAKE_CONTEXT.toolUseContext,
    )
    expect(later).toBe(true)
  })

  test('executePostSamplingHooks itself does not reject when a hook throws', async () => {
    registerPostSamplingHook(async () => {
      throw new Error('always-throws')
    })
    await expect(
      executePostSamplingHooks(
        FAKE_CONTEXT.messages,
        FAKE_CONTEXT.systemPrompt,
        FAKE_CONTEXT.userContext,
        FAKE_CONTEXT.systemContext,
        FAKE_CONTEXT.toolUseContext,
      ),
    ).resolves.toBeUndefined()
  })

  test('non-Error throw values (string, object) are also handled', async () => {
    let later = false
    registerPostSamplingHook(async () => {
      throw 'plain-string-error'
    })
    registerPostSamplingHook(async () => {
      throw { weird: 'object' }
    })
    registerPostSamplingHook(async () => {
      later = true
    })
    await executePostSamplingHooks(
      FAKE_CONTEXT.messages,
      FAKE_CONTEXT.systemPrompt,
      FAKE_CONTEXT.userContext,
      FAKE_CONTEXT.systemContext,
      FAKE_CONTEXT.toolUseContext,
    )
    expect(later).toBe(true)
  })
})

describe('empty registration', () => {
  test('executePostSamplingHooks with no registered hooks resolves cleanly', async () => {
    await expect(
      executePostSamplingHooks(
        FAKE_CONTEXT.messages,
        FAKE_CONTEXT.systemPrompt,
        FAKE_CONTEXT.userContext,
        FAKE_CONTEXT.systemContext,
        FAKE_CONTEXT.toolUseContext,
      ),
    ).resolves.toBeUndefined()
  })
})
