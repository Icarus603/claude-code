/**
 * Tests for team-name / agent-name sanitizers.
 *
 * sanitizeName goes into tmux window names, worktree paths, and file
 * system paths. A typo lets a hostile team name escape the dash-only
 * allowlist and corrupt tmux state or write outside the teams dir.
 *
 * sanitizeAgentName disambiguates the "agentName@teamName" format —
 * an `@` inside the agent name would split incorrectly downstream.
 */
import { describe, expect, test } from 'bun:test'
import { sanitizeAgentName, sanitizeName } from '../core/teamHelpers.js'

describe('sanitizeName — allowlist', () => {
  test('alphanumeric pass through (lowercased)', () => {
    expect(sanitizeName('alpha')).toBe('alpha')
    expect(sanitizeName('Team123')).toBe('team123')
  })

  test('mixed case is lowercased', () => {
    expect(sanitizeName('FooBarBaz')).toBe('foobarbaz')
  })

  test('empty string → empty string', () => {
    expect(sanitizeName('')).toBe('')
  })
})

describe('sanitizeName — replacement', () => {
  test('spaces → hyphens', () => {
    expect(sanitizeName('hello world')).toBe('hello-world')
  })

  test('underscore → hyphen (only alphanumeric pass; underscore replaced)', () => {
    // The regex is [^a-zA-Z0-9] — underscore IS replaced (different
    // from sanitizePathComponent which keeps underscores).
    expect(sanitizeName('foo_bar')).toBe('foo-bar')
  })

  test('hyphen pass through (already a hyphen)', () => {
    // Wait — hyphens aren't in [a-zA-Z0-9], so they get replaced with...
    // hyphens! Self-replacement is a no-op visible behavior.
    expect(sanitizeName('foo-bar')).toBe('foo-bar')
  })

  test('dot, slash, colon → hyphens', () => {
    expect(sanitizeName('foo.bar/baz:qux')).toBe('foo-bar-baz-qux')
  })

  test('shell metachars all replaced', () => {
    expect(sanitizeName('a;b`c$d|e')).toBe('a-b-c-d-e')
  })

  test('null byte and newline replaced', () => {
    expect(sanitizeName('a\0b\nc')).toBe('a-b-c')
  })

  test('CJK characters → all hyphens', () => {
    // 中文: 2 chars × 1 hyphen each → "--"
    expect(sanitizeName('中文')).toBe('--')
  })

  test('emoji → multiple hyphens (one per UTF-16 code unit)', () => {
    // 🎉 is 2 UTF-16 code units → 2 hyphens.
    expect(sanitizeName('a🎉b')).toBe('a--b')
  })

  test('path-traversal vector gutted', () => {
    expect(sanitizeName('../etc')).toBe('---etc')
  })
})

describe('sanitizeName — idempotency', () => {
  test('sanitized output passes through unchanged', () => {
    const input = 'foo bar/baz QUX'
    const first = sanitizeName(input)
    expect(sanitizeName(first)).toBe(first)
  })
})

// Inline test of appendCappedMessage from tasks/types.ts (shared
// commentary tying it to the whale-session memory bug analysis).
import { appendCappedMessage } from '../tasks/types.js'

describe('appendCappedMessage — bounded message buffer (cap=50)', () => {
  test('undefined prev → single-element array', () => {
    expect(appendCappedMessage(undefined, 'x')).toEqual(['x'])
  })

  test('empty prev → single-element array', () => {
    expect(appendCappedMessage([], 'x')).toEqual(['x'])
  })

  test('under-cap append: returns new array (immutability)', () => {
    const prev = [1, 2, 3]
    const next = appendCappedMessage(prev, 4)
    expect(next).toEqual([1, 2, 3, 4])
    expect(next).not.toBe(prev) // new array
    expect(prev).toEqual([1, 2, 3]) // prev unchanged
  })

  test('exactly-at-cap append: oldest dropped', () => {
    // Cap is 50. Build a 50-elem array, append → drop element 0.
    const prev = Array.from({ length: 50 }, (_, i) => i)
    const next = appendCappedMessage(prev, 99)
    expect(next).toHaveLength(50)
    expect(next[0]).toBe(1) // dropped 0
    expect(next[49]).toBe(99) // appended at end
  })

  test('above-cap append: drops MULTIPLE oldest entries', () => {
    // 100 elements + append → keep last 49 + new = 50 total.
    const prev = Array.from({ length: 100 }, (_, i) => i)
    const next = appendCappedMessage(prev, 999)
    expect(next).toHaveLength(50)
    // slice(-(50-1)) keeps last 49 elements (indexes 51..99), then push(999).
    expect(next[0]).toBe(51) // dropped 0..50
    expect(next[48]).toBe(99)
    expect(next[49]).toBe(999)
  })

  test('always returns new array (no in-place mutation)', () => {
    const prev = [1, 2]
    const next = appendCappedMessage(prev, 3)
    expect(next).not.toBe(prev)
  })
})

describe('sanitizeAgentName', () => {
  test('no @ → unchanged', () => {
    expect(sanitizeAgentName('alice')).toBe('alice')
  })

  test('@ → hyphen', () => {
    expect(sanitizeAgentName('alice@bob')).toBe('alice-bob')
  })

  test('multiple @ all replaced', () => {
    expect(sanitizeAgentName('a@b@c')).toBe('a-b-c')
  })

  test('keeps everything else (only @ targeted)', () => {
    // Important contrast with sanitizeName: this only replaces @,
    // preserves spaces, dots, etc. The disambiguation is for the
    // agentName@teamName format, not full path safety.
    expect(sanitizeAgentName('Alice Smith.123')).toBe('Alice Smith.123')
  })

  test('empty string → empty', () => {
    expect(sanitizeAgentName('')).toBe('')
  })

  test('only @ → only -', () => {
    expect(sanitizeAgentName('@@@')).toBe('---')
  })
})
