/**
 * Tests for the Mailbox class — async message queue with filter support.
 *
 * The class is the message-passing primitive between teammate workers.
 * Wrong waiter dispatch causes deadlocks (worker stuck in receive() while
 * messages pile up). Wrong polling consumes messages out of order.
 */
import { describe, expect, test } from 'bun:test'
import { Mailbox, type Message } from '../runtime/mailbox.js'

function msg(over: Partial<Message> & { id: string }): Message {
  return {
    source: 'user',
    content: '',
    timestamp: '2026-04-30T00:00:00Z',
    ...over,
  } as Message
}

describe('Mailbox — initial state', () => {
  test('new mailbox is empty', () => {
    const mb = new Mailbox()
    expect(mb.length).toBe(0)
    expect(mb.revision).toBe(0)
  })
})

describe('Mailbox — send + poll', () => {
  test('send + poll round-trips a message', () => {
    const mb = new Mailbox()
    const m = msg({ id: 'm1' })
    mb.send(m)
    expect(mb.length).toBe(1)
    expect(mb.poll()).toBe(m)
    expect(mb.length).toBe(0)
  })

  test('FIFO order with default poll', () => {
    const mb = new Mailbox()
    const a = msg({ id: 'a' })
    const b = msg({ id: 'b' })
    const c = msg({ id: 'c' })
    mb.send(a)
    mb.send(b)
    mb.send(c)
    expect(mb.poll()).toBe(a)
    expect(mb.poll()).toBe(b)
    expect(mb.poll()).toBe(c)
  })

  test('poll on empty returns undefined', () => {
    expect(new Mailbox().poll()).toBeUndefined()
  })

  test('filtered poll skips non-matching messages', () => {
    const mb = new Mailbox()
    const user = msg({ id: 'u', source: 'user' })
    const teammate = msg({ id: 't', source: 'teammate' })
    mb.send(user)
    mb.send(teammate)
    // Poll for teammate first → should return teammate, leave user.
    expect(mb.poll(m => m.source === 'teammate')).toBe(teammate)
    expect(mb.length).toBe(1)
    expect(mb.poll()).toBe(user)
  })

  test('revision increments on send', () => {
    const mb = new Mailbox()
    expect(mb.revision).toBe(0)
    mb.send(msg({ id: 'a' }))
    expect(mb.revision).toBe(1)
    mb.send(msg({ id: 'b' }))
    expect(mb.revision).toBe(2)
  })
})

describe('Mailbox — receive (async)', () => {
  test('receive resolves immediately if message already in queue', async () => {
    const mb = new Mailbox()
    const m = msg({ id: 'a' })
    mb.send(m)
    const result = await mb.receive()
    expect(result).toBe(m)
  })

  test('receive blocks until matching message arrives', async () => {
    const mb = new Mailbox()
    const promise = mb.receive(m => m.source === 'teammate')
    // Send a non-matching message first — should NOT resolve.
    const wrong = msg({ id: 'w', source: 'user' })
    mb.send(wrong)
    // It should still be pending; queue should have the user message.
    expect(mb.length).toBe(1)
    // Send the match — promise resolves.
    const right = msg({ id: 'r', source: 'teammate' })
    mb.send(right)
    const result = await promise
    expect(result).toBe(right)
  })

  test('multiple waiters: first match wins', async () => {
    const mb = new Mailbox()
    const userPromise = mb.receive(m => m.source === 'user')
    const teammatePromise = mb.receive(m => m.source === 'teammate')

    const teammateMsg = msg({ id: 't', source: 'teammate' })
    mb.send(teammateMsg)
    // teammatePromise should resolve, userPromise still pending.
    expect(await teammatePromise).toBe(teammateMsg)

    const userMsg = msg({ id: 'u', source: 'user' })
    mb.send(userMsg)
    expect(await userPromise).toBe(userMsg)
  })

  test('waiter NOT in queue (matched directly to send)', async () => {
    const mb = new Mailbox()
    const promise = mb.receive()
    const m = msg({ id: 'a' })
    mb.send(m)
    expect(await promise).toBe(m)
    // Length stays 0 — message went straight to waiter, never queued.
    expect(mb.length).toBe(0)
  })
})

describe('Mailbox — subscribe (signal)', () => {
  test('subscribe fires on send', () => {
    const mb = new Mailbox()
    let count = 0
    const unsubscribe = mb.subscribe(() => {
      count++
    })
    mb.send(msg({ id: 'a' }))
    mb.send(msg({ id: 'b' }))
    expect(count).toBe(2)
    unsubscribe()
    mb.send(msg({ id: 'c' }))
    expect(count).toBe(2) // unsubscribed
  })

  test('subscribe fires on receive (queue drain)', async () => {
    const mb = new Mailbox()
    mb.send(msg({ id: 'pre' }))
    let count = 0
    mb.subscribe(() => {
      count++
    })
    await mb.receive()
    expect(count).toBe(1)
  })
})

describe('Mailbox — edge cases', () => {
  test('send respects waiter filter — no match keeps message in queue', () => {
    const mb = new Mailbox()
    const promise = mb.receive(m => m.source === 'teammate')
    void promise // mark promise as intentionally pending
    const wrong = msg({ id: 'w', source: 'user' })
    mb.send(wrong)
    expect(mb.length).toBe(1)
    expect(mb.poll()).toBe(wrong)
  })

  test('multiple waiters with same filter: first registered gets first match', async () => {
    const mb = new Mailbox()
    const order: string[] = []
    const p1 = mb.receive().then(m => {
      order.push(`p1:${m.id}`)
    })
    const p2 = mb.receive().then(m => {
      order.push(`p2:${m.id}`)
    })
    mb.send(msg({ id: 'a' }))
    mb.send(msg({ id: 'b' }))
    await p1
    await p2
    expect(order).toEqual(['p1:a', 'p2:b'])
  })
})
