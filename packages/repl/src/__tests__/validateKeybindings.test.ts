/**
 * Tests for keybindings validation helpers — pure transforms over user
 * keybinding config that drive /doctor warnings on `~/.claude/keybindings.json`.
 *
 * Wrong validation = either spurious warnings (annoying) or missed
 * conflicts (real conflicts ship to users). The duplicate-key-in-JSON
 * detection is especially subtle: standard JSON.parse silently drops
 * earlier values, so this regex-based pre-parse catches them.
 */
import { describe, expect, test } from 'bun:test'
import {
  checkDuplicateKeysInJson,
  checkDuplicates,
  formatWarning,
  formatWarnings,
  validateUserConfig,
} from '../keybindings/validate.js'
import type { KeybindingBlock } from '../keybindings/types.js'

describe('validateUserConfig — top-level shape', () => {
  test('non-array → parse_error warning', () => {
    const w = validateUserConfig({ context: 'Global', bindings: {} })
    expect(w).toHaveLength(1)
    expect(w[0]?.type).toBe('parse_error')
    expect(w[0]?.severity).toBe('error')
    expect(w[0]?.message).toContain('must contain an array')
  })

  test('null → parse_error', () => {
    const w = validateUserConfig(null)
    expect(w[0]?.type).toBe('parse_error')
  })

  test('undefined → parse_error', () => {
    const w = validateUserConfig(undefined)
    expect(w[0]?.type).toBe('parse_error')
  })

  test('empty array → no warnings (valid empty config)', () => {
    expect(validateUserConfig([])).toEqual([])
  })

  test('array with valid blocks → no top-level warnings', () => {
    const w = validateUserConfig([
      { context: 'Global', bindings: { 'ctrl+a': 'app:foo' } },
    ])
    // No structural warnings; the action validation may surface other
    // warnings depending on whether 'app:foo' is a known action.
    const parseErrors = w.filter(x => x.type === 'parse_error')
    expect(parseErrors.length).toBe(0)
  })
})

describe('checkDuplicates — duplicates within single context', () => {
  test('no duplicates → empty warnings', () => {
    const blocks: KeybindingBlock[] = [
      { context: 'Global', bindings: { 'ctrl+a': 'a', 'ctrl+b': 'b' } },
    ]
    expect(checkDuplicates(blocks)).toEqual([])
  })

  test('same key + DIFFERENT action → duplicate warning', () => {
    const blocks: KeybindingBlock[] = [
      { context: 'Global', bindings: { 'ctrl+a': 'a' } },
      { context: 'Global', bindings: { 'ctrl+a': 'b' } },
    ]
    const w = checkDuplicates(blocks)
    expect(w.length).toBe(1)
    expect(w[0]?.type).toBe('duplicate')
    expect(w[0]?.context).toBe('Global')
  })

  test('same key + SAME action → no warning (idempotent re-binding)', () => {
    const blocks: KeybindingBlock[] = [
      { context: 'Global', bindings: { 'ctrl+a': 'a' } },
      { context: 'Global', bindings: { 'ctrl+a': 'a' } },
    ]
    expect(checkDuplicates(blocks)).toEqual([])
  })

  test('same key in DIFFERENT contexts → no warning (independent)', () => {
    const blocks: KeybindingBlock[] = [
      { context: 'Global', bindings: { 'ctrl+a': 'g_a' } },
      { context: 'Confirmation', bindings: { 'ctrl+a': 'c_a' } },
    ]
    expect(checkDuplicates(blocks)).toEqual([])
  })

  test('case-insensitive duplicate detection', () => {
    // Normalization downcases modifiers + main key.
    const blocks: KeybindingBlock[] = [
      { context: 'Global', bindings: { 'Ctrl+A': 'a' } },
      { context: 'Global', bindings: { 'ctrl+a': 'b' } },
    ]
    const w = checkDuplicates(blocks)
    expect(w.length).toBe(1)
  })

  test('modifier-order-independent duplicate detection', () => {
    // 'ctrl+shift+a' and 'shift+ctrl+a' are the same chord.
    const blocks: KeybindingBlock[] = [
      { context: 'Global', bindings: { 'ctrl+shift+a': 'a' } },
      { context: 'Global', bindings: { 'shift+ctrl+a': 'b' } },
    ]
    const w = checkDuplicates(blocks)
    expect(w.length).toBe(1)
  })
})

describe('checkDuplicateKeysInJson — string-level pre-parse detection', () => {
  test('JSON without duplicate keys → no warnings', () => {
    const json = `[{"context":"Global","bindings":{"ctrl+a":"a","ctrl+b":"b"}}]`
    expect(checkDuplicateKeysInJson(json)).toEqual([])
  })

  test('JSON with duplicate key in same bindings block → warning', () => {
    // JSON.parse silently drops the first one — this catches them BEFORE parse.
    const json = `[{"context":"Global","bindings":{"ctrl+a":"first","ctrl+a":"second"}}]`
    const w = checkDuplicateKeysInJson(json)
    expect(w.length).toBe(1)
    expect(w[0]?.type).toBe('duplicate')
    expect(w[0]?.key).toBe('ctrl+a')
    expect(w[0]?.context).toBe('Global')
  })

  test('triple duplicate → warning fires only ONCE (on second occurrence)', () => {
    const json = `[{"context":"Global","bindings":{"ctrl+a":"1","ctrl+a":"2","ctrl+a":"3"}}]`
    const w = checkDuplicateKeysInJson(json)
    expect(w.length).toBe(1) // Documented: only second occurrence triggers
  })

  test('different contexts with same key → NO warning', () => {
    const json = `[{"context":"Global","bindings":{"ctrl+a":"1"}},{"context":"Chat","bindings":{"ctrl+a":"2"}}]`
    expect(checkDuplicateKeysInJson(json)).toEqual([])
  })

  test('warning includes JSON-coverage suggestion', () => {
    const json = `[{"context":"Global","bindings":{"ctrl+a":"1","ctrl+a":"2"}}]`
    const w = checkDuplicateKeysInJson(json)
    expect(w[0]?.suggestion).toMatch(/JSON uses the last value/)
  })
})

describe('formatWarning — pretty-print', () => {
  test('error severity uses ✗', () => {
    expect(
      formatWarning({
        type: 'parse_error',
        severity: 'error',
        message: 'bad',
      }),
    ).toContain('✗')
  })

  test('warning severity uses ⚠', () => {
    expect(
      formatWarning({
        type: 'duplicate',
        severity: 'warning',
        message: 'dup',
      }),
    ).toContain('⚠')
  })

  test('includes severity word in output', () => {
    const out = formatWarning({
      type: 'parse_error',
      severity: 'error',
      message: 'bad',
    })
    expect(out).toContain('error')
    expect(out).toContain('bad')
  })

  test('appends suggestion on a new line when present', () => {
    const out = formatWarning({
      type: 'duplicate',
      severity: 'warning',
      message: 'dup',
      suggestion: 'try renaming',
    })
    expect(out).toContain('\n')
    expect(out).toContain('try renaming')
  })

  test('no suggestion = no trailing newline', () => {
    const out = formatWarning({
      type: 'parse_error',
      severity: 'error',
      message: 'bad',
    })
    expect(out).not.toContain('\n')
  })
})

describe('formatWarnings — multi-warning aggregation', () => {
  test('empty array → empty string', () => {
    expect(formatWarnings([])).toBe('')
  })

  test('multiple warnings joined with newlines', () => {
    const out = formatWarnings([
      { type: 'parse_error', severity: 'error', message: 'a' },
      { type: 'duplicate', severity: 'warning', message: 'b' },
    ])
    // Each warning takes one line minimum.
    expect(out.split('\n').length).toBeGreaterThanOrEqual(2)
    expect(out).toContain('a')
    expect(out).toContain('b')
  })
})
