import { describe, expect, test } from 'bun:test'

import {
  CLAUDE_AI_CONNECTION_ID,
  CONSOLE_CONNECTION_ID,
  CODEX_CONNECTION_ID,
  generateConnectionId,
  isWellKnownConnection,
  prettyModelLabel,
} from '../connections.ts'

/**
 * Pin connection helper invariants:
 * - Well-known connection IDs (these are special-cased throughout the
 *   codebase: claude-account auto-creates on /login, codex auto-routes
 *   to the codex provider, etc.)
 * - prettyModelLabel strips migration-era "Alias (wire-id)" labels
 * - generateConnectionId produces stable-format unique IDs
 */
describe('connection helpers', () => {
  describe('well-known connection IDs', () => {
    test('CLAUDE_AI_CONNECTION_ID = "claude-account" (matches /login auto-create)', () => {
      expect(CLAUDE_AI_CONNECTION_ID).toBe('claude-account')
    })

    test('CONSOLE_CONNECTION_ID = "anthropic-console"', () => {
      expect(CONSOLE_CONNECTION_ID).toBe('anthropic-console')
    })

    test('CODEX_CONNECTION_ID = "chatgpt-codex"', () => {
      expect(CODEX_CONNECTION_ID).toBe('chatgpt-codex')
    })

    test('isWellKnownConnection recognizes all three', () => {
      expect(isWellKnownConnection('claude-account')).toBe(true)
      expect(isWellKnownConnection('anthropic-console')).toBe(true)
      expect(isWellKnownConnection('chatgpt-codex')).toBe(true)
    })

    test('isWellKnownConnection rejects user-generated IDs', () => {
      expect(isWellKnownConnection('conn_abc12345')).toBe(false)
      expect(isWellKnownConnection('foo')).toBe(false)
      expect(isWellKnownConnection('')).toBe(false)
    })
  })

  describe('prettyModelLabel', () => {
    test('strips "Alias (wire-id)" when wire-id matches model.id exactly', () => {
      // Migration writes "Opus (deepseek-v4-pro[1m])" but the alias prefix
      // is meaningless once the row exists. Strip it.
      const result = prettyModelLabel({
        id: 'deepseek-v4-pro[1m]',
        label: 'Opus (deepseek-v4-pro[1m])',
      } as any)
      expect(result).toBe('deepseek-v4-pro[1m]')
    })

    test('passes through native records (no parens)', () => {
      const result = prettyModelLabel({
        id: 'claude-opus-4-7',
        label: 'Opus 4.7',
      } as any)
      expect(result).toBe('Opus 4.7')
    })

    test('preserves labels with parens that AREN\'T the wire id', () => {
      // "Sonnet 4 (preview)" — the paren content isn't the model id, so
      // it's not a migration artifact; show as-is.
      const result = prettyModelLabel({
        id: 'claude-sonnet-4',
        label: 'Sonnet 4 (preview)',
      } as any)
      expect(result).toBe('Sonnet 4 (preview)')
    })

    test('trims whitespace in label before matching', () => {
      const result = prettyModelLabel({
        id: 'gpt-5.5',
        label: '  ChatGPT (gpt-5.5)  ',
      } as any)
      expect(result).toBe('gpt-5.5')
    })
  })

  describe('generateConnectionId', () => {
    test('format: "conn_" + 8 lowercase-alphanumeric chars', () => {
      const id = generateConnectionId()
      expect(id).toMatch(/^conn_[a-z0-9]{8}$/)
    })

    test('produces different IDs on consecutive calls (no test-environment collisions)', () => {
      // Math.random based — tiny chance of collision but 36^8 = 2.8 quadrillion.
      // Sampling 100 should be safe.
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) ids.add(generateConnectionId())
      expect(ids.size).toBe(100)
    })

    test('total length is exactly 13 chars (5 prefix + 8 random)', () => {
      expect(generateConnectionId().length).toBe(13)
    })

    test('never collides with well-known IDs (different prefix)', () => {
      // Well-known IDs don't start with "conn_". Pin defensively.
      for (let i = 0; i < 20; i++) {
        const id = generateConnectionId()
        expect(isWellKnownConnection(id)).toBe(false)
      }
    })
  })
})
