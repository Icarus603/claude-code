import { describe, expect, test } from 'bun:test'
import { generateKeybindingsTemplate } from '../keybindings/template.js'
import { KeybindingsSchema } from '../keybindings/schema.js'

describe('generateKeybindingsTemplate', () => {
  test('produces valid JSON', () => {
    const tpl = generateKeybindingsTemplate()
    expect(() => JSON.parse(tpl)).not.toThrow()
  })
  test('includes $schema metadata', () => {
    const tpl = generateKeybindingsTemplate()
    const parsed = JSON.parse(tpl) as { $schema?: string }
    expect(parsed.$schema).toBe(
      'https://www.schemastore.org/claude-code-keybindings.json',
    )
  })
  test('includes $docs URL', () => {
    const parsed = JSON.parse(generateKeybindingsTemplate()) as {
      $docs?: string
    }
    expect(parsed.$docs).toBe('https://code.claude.com/docs/en/keybindings')
  })
  test('output validates against KeybindingsSchema (round-trip safe)', () => {
    // This is a regression guard: the template is what users copy into
    // ~/.claude/keybindings.json — so it MUST validate. Caught a real bug
    // 2026-04-29 where DEFAULT_BINDINGS used FormField/Scroll/EffortPicker
    // contexts that weren't in KEYBINDING_CONTEXTS (template would parse
    // as JSON but validate-fail in /doctor checks).
    const parsed = JSON.parse(generateKeybindingsTemplate())
    expect(KeybindingsSchema().safeParse(parsed).success).toBe(true)
  })
  test('contains at least one binding block', () => {
    const parsed = JSON.parse(generateKeybindingsTemplate()) as {
      bindings: unknown[]
    }
    expect(parsed.bindings.length).toBeGreaterThan(0)
  })
  test('does NOT include reserved ctrl+c (filtered out)', () => {
    const parsed = JSON.parse(generateKeybindingsTemplate()) as {
      bindings: { bindings: Record<string, unknown> }[]
    }
    for (const block of parsed.bindings) {
      // Check no chord step is exactly ctrl+c (allow ctrl+ctrl-c-like prefixes
      // if hypothetically valid).
      for (const key of Object.keys(block.bindings)) {
        for (const step of key.toLowerCase().split(/\s+/)) {
          expect(step).not.toBe('ctrl+c')
        }
      }
    }
  })
  test('does NOT include reserved ctrl+d (filtered out)', () => {
    const parsed = JSON.parse(generateKeybindingsTemplate()) as {
      bindings: { bindings: Record<string, unknown> }[]
    }
    for (const block of parsed.bindings) {
      for (const key of Object.keys(block.bindings)) {
        // Match only standalone ctrl+d, not ctrl+down etc. — split on
        // whitespace for chord steps and check exact equality.
        for (const step of key.toLowerCase().split(/\s+/)) {
          expect(step).not.toBe('ctrl+d')
        }
      }
    }
  })
  test('output ends with newline', () => {
    expect(generateKeybindingsTemplate().endsWith('\n')).toBe(true)
  })
  test('output is pretty-printed (2-space indent)', () => {
    const tpl = generateKeybindingsTemplate()
    expect(tpl).toContain('  "$schema"')
  })
  test('produces deterministic output (idempotent)', () => {
    expect(generateKeybindingsTemplate()).toBe(generateKeybindingsTemplate())
  })
  test('every block has at least one binding (empty blocks filtered)', () => {
    const parsed = JSON.parse(generateKeybindingsTemplate()) as {
      bindings: { bindings: Record<string, unknown> }[]
    }
    for (const block of parsed.bindings) {
      expect(Object.keys(block.bindings).length).toBeGreaterThan(0)
    }
  })
})
