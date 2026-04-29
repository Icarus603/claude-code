import { describe, expect, mock, test } from 'bun:test'
import { createLinkedTransportPair } from '../InProcessTransport.js'

describe('createLinkedTransportPair — basic structure', () => {
  test('returns array of length 2', () => {
    const pair = createLinkedTransportPair()
    expect(pair).toHaveLength(2)
  })

  test('both transports have Transport interface methods', () => {
    const [a, b] = createLinkedTransportPair()
    expect(typeof a.start).toBe('function')
    expect(typeof a.send).toBe('function')
    expect(typeof a.close).toBe('function')
    expect(typeof b.start).toBe('function')
    expect(typeof b.send).toBe('function')
    expect(typeof b.close).toBe('function')
  })

  test('start() resolves without throwing (no setup needed)', async () => {
    const [a, b] = createLinkedTransportPair()
    await expect(a.start()).resolves.toBeUndefined()
    await expect(b.start()).resolves.toBeUndefined()
  })
})

describe('send/onmessage — message delivery', () => {
  test('a.send delivers to b.onmessage', async () => {
    const [a, b] = createLinkedTransportPair()
    const handler = mock(() => {})
    b.onmessage = handler
    await a.send({ jsonrpc: '2.0', method: 'ping', id: 1 } as never)
    // queueMicrotask delivery — wait for next tick
    await new Promise(resolve => queueMicrotask(() => resolve(undefined)))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[0]).toEqual({
      jsonrpc: '2.0',
      method: 'ping',
      id: 1,
    })
  })

  test('b.send delivers to a.onmessage (bidirectional)', async () => {
    const [a, b] = createLinkedTransportPair()
    const handler = mock(() => {})
    a.onmessage = handler
    await b.send({ jsonrpc: '2.0', result: 'pong', id: 1 } as never)
    await new Promise(resolve => queueMicrotask(() => resolve(undefined)))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('send delivery happens via queueMicrotask (NOT during the send call itself)', () => {
    // Critical: synchronous delivery would create deep call stacks for
    // request/response cycles. queueMicrotask defers to next microtask.
    // Test the synchronous portion: BEFORE awaiting the send promise,
    // the handler must not have run.
    const [a, b] = createLinkedTransportPair()
    let called = false
    b.onmessage = () => {
      called = true
    }
    // Call send WITHOUT awaiting — this returns a Promise<void> immediately
    // and schedules the microtask. The handler must NOT have been called
    // synchronously during the send invocation.
    void a.send({ jsonrpc: '2.0', method: 'x', id: 1 } as never)
    expect(called).toBe(false)
  })

  test('multiple sends are delivered in order', async () => {
    const [a, b] = createLinkedTransportPair()
    const received: number[] = []
    b.onmessage = msg => {
      received.push((msg as { id: number }).id)
    }
    await a.send({ jsonrpc: '2.0', method: 'm', id: 1 } as never)
    await a.send({ jsonrpc: '2.0', method: 'm', id: 2 } as never)
    await a.send({ jsonrpc: '2.0', method: 'm', id: 3 } as never)
    await new Promise(resolve => queueMicrotask(() => resolve(undefined)))
    await new Promise(resolve => queueMicrotask(() => resolve(undefined)))
    expect(received).toEqual([1, 2, 3])
  })

  test('send with no onmessage handler does NOT throw (silent drop)', async () => {
    const [a, b] = createLinkedTransportPair()
    // b.onmessage NOT set
    await expect(
      a.send({ jsonrpc: '2.0', method: 'x', id: 1 } as never),
    ).resolves.toBeUndefined()
    void b // unused but linked
  })
})

describe('close — both sides close together', () => {
  test('a.close fires a.onclose', async () => {
    const [a] = createLinkedTransportPair()
    const handler = mock(() => {})
    a.onclose = handler
    await a.close()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('a.close also fires b.onclose (linked close)', async () => {
    const [a, b] = createLinkedTransportPair()
    const aHandler = mock(() => {})
    const bHandler = mock(() => {})
    a.onclose = aHandler
    b.onclose = bHandler
    await a.close()
    expect(aHandler).toHaveBeenCalledTimes(1)
    expect(bHandler).toHaveBeenCalledTimes(1)
  })

  test('idempotent: a.close twice does not double-fire', async () => {
    const [a, b] = createLinkedTransportPair()
    const handler = mock(() => {})
    a.onclose = handler
    await a.close()
    await a.close()
    expect(handler).toHaveBeenCalledTimes(1)
    void b
  })

  test('b.close after a.close does not re-fire', async () => {
    const [a, b] = createLinkedTransportPair()
    const aHandler = mock(() => {})
    const bHandler = mock(() => {})
    a.onclose = aHandler
    b.onclose = bHandler
    await a.close()
    await b.close()
    // Each onclose fires exactly once.
    expect(aHandler).toHaveBeenCalledTimes(1)
    expect(bHandler).toHaveBeenCalledTimes(1)
  })

  test('send after close throws "Transport is closed"', async () => {
    const [a] = createLinkedTransportPair()
    await a.close()
    await expect(
      a.send({ jsonrpc: '2.0', method: 'x', id: 1 } as never),
    ).rejects.toThrow('Transport is closed')
  })

  test('send on b after a closed: b also closed → throws', async () => {
    const [a, b] = createLinkedTransportPair()
    await a.close() // closes both via linked close
    await expect(
      b.send({ jsonrpc: '2.0', method: 'x', id: 1 } as never),
    ).rejects.toThrow('Transport is closed')
  })
})

describe('isolation — multiple pairs do not cross-talk', () => {
  test('two pairs deliver independently', async () => {
    const [a1, b1] = createLinkedTransportPair()
    const [a2, b2] = createLinkedTransportPair()
    const b1Handler = mock(() => {})
    const b2Handler = mock(() => {})
    b1.onmessage = b1Handler
    b2.onmessage = b2Handler
    await a1.send({ jsonrpc: '2.0', method: 'p1', id: 1 } as never)
    await a2.send({ jsonrpc: '2.0', method: 'p2', id: 2 } as never)
    await new Promise(resolve => queueMicrotask(() => resolve(undefined)))
    expect(b1Handler).toHaveBeenCalledTimes(1)
    expect(b2Handler).toHaveBeenCalledTimes(1)
    expect(b1Handler.mock.calls[0]?.[0]).toEqual({
      jsonrpc: '2.0',
      method: 'p1',
      id: 1,
    })
    expect(b2Handler.mock.calls[0]?.[0]).toEqual({
      jsonrpc: '2.0',
      method: 'p2',
      id: 2,
    })
  })

  test('closing one pair does not close the other', async () => {
    const [a1, b1] = createLinkedTransportPair()
    const [a2, b2] = createLinkedTransportPair()
    const b1Handler = mock(() => {})
    const b2Handler = mock(() => {})
    b1.onmessage = b1Handler
    b2.onmessage = b2Handler
    await a1.close()
    // pair 2 should still work
    await a2.send({ jsonrpc: '2.0', method: 'p2', id: 1 } as never)
    await new Promise(resolve => queueMicrotask(() => resolve(undefined)))
    expect(b2Handler).toHaveBeenCalledTimes(1)
    void b1
  })
})
