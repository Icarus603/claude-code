/**
 * Tests for sanitizePathComponent — path-traversal mitigation for the
 * `~/.claude/tasks/<list-id>/<task-id>.json` write path.
 *
 * The function is the ONLY guard between user-supplied taskListId /
 * taskId and the filesystem write. A regression here lets a malicious
 * task name escape into other users' directories or overwrite arbitrary
 * files outside ~/.claude/tasks.
 *
 * Per the docstring: "Only allows alphanumeric characters, hyphens,
 * and underscores." All other chars get replaced with `-`.
 */
import { describe, expect, test } from 'bun:test'
import { sanitizePathComponent } from '../tasks.js'

describe('sanitizePathComponent — allowlist', () => {
  test('alphanumeric pass through unchanged', () => {
    expect(sanitizePathComponent('abc123')).toBe('abc123')
    expect(sanitizePathComponent('XYZ')).toBe('XYZ')
  })

  test('hyphens preserved', () => {
    expect(sanitizePathComponent('a-b-c')).toBe('a-b-c')
  })

  test('underscores preserved', () => {
    expect(sanitizePathComponent('a_b_c')).toBe('a_b_c')
  })

  test('mixed allowed chars preserved', () => {
    expect(sanitizePathComponent('Task_123-abc')).toBe('Task_123-abc')
  })

  test('empty string is empty', () => {
    expect(sanitizePathComponent('')).toBe('')
  })
})

describe('sanitizePathComponent — path-traversal vectors', () => {
  test('forward slash → dash', () => {
    expect(sanitizePathComponent('a/b')).toBe('a-b')
  })

  test('backslash → dash', () => {
    expect(sanitizePathComponent('a\\b')).toBe('a-b')
  })

  test('"../" pattern collapses to dashes', () => {
    expect(sanitizePathComponent('../etc')).toBe('---etc')
  })

  test('"..\\" Windows traversal also stripped', () => {
    expect(sanitizePathComponent('..\\Windows')).toBe('---Windows')
  })

  test('absolute path-style input is gutted', () => {
    expect(sanitizePathComponent('/etc/passwd')).toBe('-etc-passwd')
  })

  test('null byte → dash', () => {
    // Null bytes can truncate strings in syscalls — must be sanitized.
    expect(sanitizePathComponent('a\0b')).toBe('a-b')
  })
})

describe('sanitizePathComponent — dangerous shell metachars', () => {
  test('semicolon → dash', () => {
    expect(sanitizePathComponent('a;rm -rf /')).toBe('a-rm--rf--')
  })

  test('backtick → dash', () => {
    expect(sanitizePathComponent('a`whoami`')).toBe('a-whoami-')
  })

  test('dollar sign → dash', () => {
    expect(sanitizePathComponent('$(echo hi)')).toBe('--echo-hi-')
  })

  test('pipe → dash', () => {
    expect(sanitizePathComponent('a|b')).toBe('a-b')
  })

  test('newline → dash', () => {
    expect(sanitizePathComponent('a\nb')).toBe('a-b')
  })

  test('CRLF → two dashes', () => {
    expect(sanitizePathComponent('a\r\nb')).toBe('a--b')
  })
})

describe('sanitizePathComponent — Unicode and exotic inputs', () => {
  test('CJK characters → dashes (not in allowlist)', () => {
    // Chinese / Japanese chars are not [a-zA-Z0-9_-] → all replaced.
    expect(sanitizePathComponent('中文')).toBe('--')
  })

  test('emoji → dashes', () => {
    // Emoji like 🎉 is two code units in JS strings; both get replaced.
    expect(sanitizePathComponent('a🎉b')).toBe('a--b')
  })

  test('accented Latin → dashes', () => {
    // ü, é, ñ are NOT [a-zA-Z] in JS regex — replaced.
    expect(sanitizePathComponent('café')).toBe('caf-')
  })

  test('whitespace (space, tab) → dashes', () => {
    expect(sanitizePathComponent('a b\tc')).toBe('a-b-c')
  })
})

describe('sanitizePathComponent — idempotency check', () => {
  test('sanitized output passes through unchanged on second call', () => {
    const input = 'foo/bar baz'
    const first = sanitizePathComponent(input)
    const second = sanitizePathComponent(first)
    expect(second).toBe(first)
  })
})
