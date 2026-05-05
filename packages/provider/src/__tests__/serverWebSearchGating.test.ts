import { describe, expect, test } from 'bun:test'
import { isAnthropicServerWebSearchCapable } from '../providers.js'

describe('isAnthropicServerWebSearchCapable', () => {
  test('firstParty always true (no model needed)', () => {
    expect(isAnthropicServerWebSearchCapable('firstParty')).toBe(true)
    expect(
      isAnthropicServerWebSearchCapable('firstParty', 'claude-opus-4-7'),
    ).toBe(true)
  })

  test('bedrock always true', () => {
    expect(isAnthropicServerWebSearchCapable('bedrock')).toBe(true)
    expect(
      isAnthropicServerWebSearchCapable(
        'bedrock',
        'anthropic.claude-3-5-sonnet-20241022-v2:0',
      ),
    ).toBe(true)
  })

  test('foundry always true', () => {
    expect(isAnthropicServerWebSearchCapable('foundry')).toBe(true)
  })

  test('vertex requires Claude 4-series model', () => {
    expect(isAnthropicServerWebSearchCapable('vertex')).toBe(false)
    expect(isAnthropicServerWebSearchCapable('vertex', 'claude-3-5-sonnet')).toBe(
      false,
    )
    expect(isAnthropicServerWebSearchCapable('vertex', 'claude-opus-4-7')).toBe(
      true,
    )
    expect(
      isAnthropicServerWebSearchCapable('vertex', 'claude-sonnet-4-6'),
    ).toBe(true)
    expect(
      isAnthropicServerWebSearchCapable('vertex', 'claude-haiku-4-5-20251001'),
    ).toBe(true)
  })

  test('vertex matches case-insensitively', () => {
    expect(isAnthropicServerWebSearchCapable('vertex', 'CLAUDE-OPUS-4-7')).toBe(
      true,
    )
  })

  test('non-Anthropic providers always false', () => {
    expect(isAnthropicServerWebSearchCapable('openai')).toBe(false)
    expect(isAnthropicServerWebSearchCapable('openai', 'gpt-5.5')).toBe(false)
    expect(isAnthropicServerWebSearchCapable('gemini')).toBe(false)
    expect(isAnthropicServerWebSearchCapable('grok')).toBe(false)
    expect(isAnthropicServerWebSearchCapable('codex')).toBe(false)
  })
})
