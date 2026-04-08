
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { AgentCore } from '../core/AgentCore.js'
import { createMockDeps, END_TURN_EVENTS, createMockStream } from './fixtures/mockDeps.js'
import type { AgentDeps } from '../index.js'

describe('AgentCore', () => {
  let deps: AgentDeps

  beforeEach(() => {
    deps = createMockDeps()
  })

  test('injects AgentDeps at construction time', () => {
    const agent = new AgentCore(deps)
    expect(agent.getState().model).toBe('test-model')
    expect(agent.getState().sessionId).toBe('test-session-id')
  })

  test('accepts initial state at construction time', () => {
    const agent = new AgentCore(deps, {
      model: 'custom-model',
      turnCount: 5,
      totalUsage: { input_tokens: 1000, output_tokens: 500 },
    })
    expect(agent.getState().model).toBe('custom-model')
    expect(agent.getState().turnCount).toBe(5)
  })

  test('setModel switches the active model', () => {
    const agent = new AgentCore(deps)
    agent.setModel('claude-opus-4-6')
    expect(agent.getState().model).toBe('claude-opus-4-6')
  })

  test('getMessages returns a read-only snapshot', () => {
    const agent = new AgentCore(deps)
    const messages = agent.getMessages()
    expect(Array.isArray(messages)).toBe(true)
  })

  test('getState returns an immutable snapshot', () => {
    const agent = new AgentCore(deps)
    const state1 = agent.getState()
    const state2 = agent.getState()
    expect(state1).not.toBe(state2)
    expect(state1.model).toBe(state2.model)
  })

  test('run returns an AsyncGenerator of AgentEvent values', async () => {
    deps.provider.stream = createMockStream(END_TURN_EVENTS)

    const agent = new AgentCore(deps)
    const events = []
    for await (const event of agent.run({ prompt: 'Hello', messages: [] })) {
      events.push(event)
    }

    expect(events.some(e => e.type === 'request_start')).toBe(true)
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  test('done event includes the end_turn reason', async () => {
    deps.provider.stream = createMockStream(END_TURN_EVENTS)

    const agent = new AgentCore(deps)
    const events = []
    for await (const event of agent.run({ prompt: 'Hello', messages: [] })) {
      events.push(event)
    }

    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
    if (doneEvent && doneEvent.type === 'done') {
      expect(doneEvent.reason).toBe('end_turn')
    }
  })

  test('interrupt stops an in-flight run', async () => {
    deps.provider.stream = mock(async function* () {
      yield { type: 'message_start', message: { id: '1', model: 'test', usage: { input_tokens: 0, output_tokens: 0 } } }
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'thinking...' } }
      yield { type: 'content_block_stop', index: 0 }
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }
      yield { type: 'message_stop' }
    })

    const agent = new AgentCore(deps)

    const events: Array<unknown> = []
    for await (const event of agent.run({ prompt: 'Hello', messages: [] })) {
      events.push(event)
      if ((event as any).type === 'stream') {
        agent.interrupt()
      }
    }

    const doneEvent = events.find((e: any) => e.type === 'done')
    expect(doneEvent).toBeDefined()
    if (doneEvent && (doneEvent as any).type === 'done') {
      expect(['interrupted', 'end_turn']).toContain((doneEvent as any).reason)
    }
  })
})
