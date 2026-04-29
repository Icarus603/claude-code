import { describe, expect, test } from 'bun:test'
import { countUserPromptsInMessages } from '../attribution.js'

type Msg = Parameters<typeof countUserPromptsInMessages>[0][number]

const userText = (text: string): Msg => ({
  type: 'user',
  message: { content: text },
})

const userBlocks = (blocks: unknown): Msg => ({
  type: 'user',
  message: { content: blocks },
})

const assistantMsg = (text: string): Msg => ({
  type: 'assistant',
  message: { content: text },
})

describe('countUserPromptsInMessages — basic', () => {
  test('empty array → 0', () => {
    expect(countUserPromptsInMessages([])).toBe(0)
  })
  test('counts one user message with text', () => {
    expect(countUserPromptsInMessages([userText('hello')])).toBe(1)
  })
  test('skips non-user messages', () => {
    expect(
      countUserPromptsInMessages([userText('a'), assistantMsg('b'), userText('c')]),
    ).toBe(2)
  })
  test('skips messages with no content', () => {
    const noContent: Msg = { type: 'user' }
    expect(countUserPromptsInMessages([noContent])).toBe(0)
  })
  test('skips messages with empty content', () => {
    expect(countUserPromptsInMessages([userText('')])).toBe(0)
  })
  test('skips whitespace-only string content', () => {
    expect(countUserPromptsInMessages([userText('   \n\t  ')])).toBe(0)
  })
})

describe('countUserPromptsInMessages — block content', () => {
  test('text block with content counts', () => {
    expect(
      countUserPromptsInMessages([userBlocks([{ type: 'text', text: 'hi' }])]),
    ).toBe(1)
  })
  test('image block counts', () => {
    expect(
      countUserPromptsInMessages([userBlocks([{ type: 'image' }])]),
    ).toBe(1)
  })
  test('document block counts', () => {
    expect(
      countUserPromptsInMessages([userBlocks([{ type: 'document' }])]),
    ).toBe(1)
  })
  test('tool_result block does NOT count alone', () => {
    expect(
      countUserPromptsInMessages([
        userBlocks([{ type: 'tool_result', content: 'output' }]),
      ]),
    ).toBe(0)
  })
  test('mixed text + tool_result counts (text wins)', () => {
    expect(
      countUserPromptsInMessages([
        userBlocks([
          { type: 'tool_result', content: 'output' },
          { type: 'text', text: 'follow-up' },
        ]),
      ]),
    ).toBe(1)
  })
  test('empty array of blocks → 0', () => {
    expect(countUserPromptsInMessages([userBlocks([])])).toBe(0)
  })
  test('block missing type field is rejected', () => {
    expect(
      countUserPromptsInMessages([userBlocks([{ text: 'no type' }])]),
    ).toBe(0)
  })
  test('block with non-string text is rejected', () => {
    expect(
      countUserPromptsInMessages([userBlocks([{ type: 'text', text: 123 }])]),
    ).toBe(0)
  })
})

describe('countUserPromptsInMessages — terminal output filtering', () => {
  test('string content with bash terminal tag does NOT count', () => {
    // TERMINAL_OUTPUT_TAGS includes patterns like 'bash-input', 'bash-stdout'
    expect(
      countUserPromptsInMessages([userText('<bash-stdout>output</bash-stdout>')]),
    ).toBe(0)
  })
  test('block text with terminal tag does NOT count', () => {
    expect(
      countUserPromptsInMessages([
        userBlocks([{ type: 'text', text: '<bash-stdout>x</bash-stdout>' }]),
      ]),
    ).toBe(0)
  })
  test('mixed: terminal-output text + image counts (image is real user input)', () => {
    expect(
      countUserPromptsInMessages([
        userBlocks([
          { type: 'text', text: '<bash-stdout>x</bash-stdout>' },
          { type: 'image' },
        ]),
      ]),
    ).toBe(1)
  })
})
