import { describe, expect, it } from 'bun:test'
import { anthropicMessagesToOpenAI } from '../convertMessages.js'

describe('convertMessages — thinking block round-trip', () => {
  it('preserves reasoning_content from thinking blocks on assistant messages', () => {
    const messages = [
      {
        type: 'user' as const,
        uuid: 'u1',
        message: { role: 'user', content: 'hello' },
      },
      {
        type: 'assistant' as const,
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me think...', signature: 'sig123' },
            { type: 'text', text: 'Hi there!' },
          ],
        },
      },
    ]

    const openaiMessages = anthropicMessagesToOpenAI(messages, [])
    const assistantMsg = openaiMessages.find(m => m.role === 'assistant') as any

    expect(assistantMsg).toBeDefined()
    expect(assistantMsg.reasoning_content).toBe('Let me think...')
    expect(assistantMsg.content).toBe('Hi there!')
  })

  it('concatenates multiple thinking blocks into single reasoning_content', () => {
    const messages = [
      {
        type: 'assistant' as const,
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Part A. ', signature: 'sig1' },
            { type: 'thinking', thinking: 'Part B.', signature: 'sig2' },
            { type: 'text', text: 'Answer' },
          ],
        },
      },
    ]

    const openaiMessages = anthropicMessagesToOpenAI(messages, [])
    const assistantMsg = openaiMessages.find(m => m.role === 'assistant') as any

    expect(assistantMsg.reasoning_content).toBe('Part A. Part B.')
  })

  it('does NOT add reasoning_content when there are no thinking blocks', () => {
    const messages = [
      {
        type: 'assistant' as const,
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'No thinking here' }],
        },
      },
    ]

    const openaiMessages = anthropicMessagesToOpenAI(messages, [])
    const assistantMsg = openaiMessages.find(m => m.role === 'assistant') as any

    expect(assistantMsg.reasoning_content).toBeUndefined()
    expect(assistantMsg.content).toBe('No thinking here')
  })

  it('includes reasoning_content alongside tool_calls', () => {
    const messages = [
      {
        type: 'assistant' as const,
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Need to use a tool.', signature: 'sig1' },
            {
              type: 'tool_use',
              id: 'tool_1',
              name: 'bash',
              input: { command: 'ls' },
            },
          ],
        },
      },
    ]

    const openaiMessages = anthropicMessagesToOpenAI(messages, [])
    const assistantMsg = openaiMessages.find(m => m.role === 'assistant') as any

    expect(assistantMsg.reasoning_content).toBe('Need to use a tool.')
    expect(assistantMsg.tool_calls).toHaveLength(1)
    expect(assistantMsg.tool_calls[0].function.name).toBe('bash')
  })
})
