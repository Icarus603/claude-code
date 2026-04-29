import { describe, expect, test } from 'bun:test'
import {
  KEYBINDING_ACTIONS,
  KEYBINDING_CONTEXT_DESCRIPTIONS,
  KEYBINDING_CONTEXTS,
  KeybindingBlockSchema,
  KeybindingsSchema,
} from '../keybindings/schema.js'

describe('KEYBINDING_CONTEXTS', () => {
  test('contains Global context', () => {
    expect(KEYBINDING_CONTEXTS).toContain('Global')
  })
  test('every context has a description entry', () => {
    for (const ctx of KEYBINDING_CONTEXTS) {
      expect(KEYBINDING_CONTEXT_DESCRIPTIONS[ctx]).toBeDefined()
      expect(KEYBINDING_CONTEXT_DESCRIPTIONS[ctx]!.length).toBeGreaterThan(0)
    }
  })
  test('contexts are unique (no duplicates)', () => {
    expect(new Set(KEYBINDING_CONTEXTS).size).toBe(KEYBINDING_CONTEXTS.length)
  })
})

describe('KEYBINDING_ACTIONS', () => {
  test('actions are namespaced (contain colon)', () => {
    for (const action of KEYBINDING_ACTIONS) {
      expect(action.includes(':')).toBe(true)
    }
  })
  test('actions are unique', () => {
    expect(new Set(KEYBINDING_ACTIONS).size).toBe(KEYBINDING_ACTIONS.length)
  })
  test('contains app:exit (sanity)', () => {
    expect(KEYBINDING_ACTIONS).toContain('app:exit')
  })
})

describe('KeybindingBlockSchema — accepts valid blocks', () => {
  const schema = KeybindingBlockSchema()
  test('Global context with action binding', () => {
    expect(
      schema.safeParse({
        context: 'Global',
        bindings: { 'ctrl+a': 'app:exit' },
      }).success,
    ).toBe(true)
  })
  test('command: prefix binding', () => {
    expect(
      schema.safeParse({
        context: 'Global',
        bindings: { 'ctrl+k': 'command:help' },
      }).success,
    ).toBe(true)
  })
  test('null value (unbind)', () => {
    expect(
      schema.safeParse({
        context: 'Global',
        bindings: { 'ctrl+a': null },
      }).success,
    ).toBe(true)
  })
  test('multiple bindings in one block', () => {
    expect(
      schema.safeParse({
        context: 'Global',
        bindings: {
          'ctrl+a': 'app:exit',
          'ctrl+b': 'command:help',
          'ctrl+c': null,
        },
      }).success,
    ).toBe(true)
  })
})

describe('KeybindingBlockSchema — rejects invalid blocks', () => {
  const schema = KeybindingBlockSchema()
  test('rejects unknown context', () => {
    expect(
      schema.safeParse({
        context: 'NotARealContext',
        bindings: {},
      }).success,
    ).toBe(false)
  })
  test('rejects unknown action (non-namespaced)', () => {
    expect(
      schema.safeParse({
        context: 'Global',
        bindings: { 'ctrl+a': 'notValidAction' },
      }).success,
    ).toBe(false)
  })
  test('rejects command: with invalid characters', () => {
    expect(
      schema.safeParse({
        context: 'Global',
        bindings: { 'ctrl+a': 'command:has space' },
      }).success,
    ).toBe(false)
  })
  test('rejects missing bindings field', () => {
    expect(
      schema.safeParse({ context: 'Global' }).success,
    ).toBe(false)
  })
})

describe('KeybindingsSchema — top-level wrapper', () => {
  const schema = KeybindingsSchema()
  test('accepts minimal valid file', () => {
    expect(schema.safeParse({ bindings: [] }).success).toBe(true)
  })
  test('accepts $schema/$docs metadata', () => {
    expect(
      schema.safeParse({
        $schema: 'https://example.com/schema.json',
        $docs: 'https://docs.example.com',
        bindings: [],
      }).success,
    ).toBe(true)
  })
  test('accepts full file with binding blocks', () => {
    expect(
      schema.safeParse({
        bindings: [
          { context: 'Global', bindings: { 'ctrl+a': 'app:exit' } },
        ],
      }).success,
    ).toBe(true)
  })
  test('rejects missing bindings field', () => {
    expect(schema.safeParse({}).success).toBe(false)
  })
  test('rejects bindings as object (must be array)', () => {
    expect(schema.safeParse({ bindings: {} }).success).toBe(false)
  })
})
