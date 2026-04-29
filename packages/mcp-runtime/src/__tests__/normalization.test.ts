import { describe, expect, test } from 'bun:test'
import { normalizeNameForMCP } from '../normalization.js'

describe('normalizeNameForMCP — alphanumeric pass-through', () => {
  test('plain ASCII letters stay unchanged', () => {
    expect(normalizeNameForMCP('hello')).toBe('hello')
  })
  test('digits stay unchanged', () => {
    expect(normalizeNameForMCP('server123')).toBe('server123')
  })
  test('underscores stay unchanged', () => {
    expect(normalizeNameForMCP('my_server')).toBe('my_server')
  })
  test('hyphens stay unchanged', () => {
    expect(normalizeNameForMCP('my-server')).toBe('my-server')
  })
})

describe('normalizeNameForMCP — invalid character replacement', () => {
  test('dots become underscores', () => {
    expect(normalizeNameForMCP('foo.bar')).toBe('foo_bar')
  })
  test('spaces become underscores', () => {
    expect(normalizeNameForMCP('hello world')).toBe('hello_world')
  })
  test('slashes become underscores', () => {
    expect(normalizeNameForMCP('foo/bar')).toBe('foo_bar')
  })
  test('non-ASCII letters become underscores', () => {
    expect(normalizeNameForMCP('café')).toBe('caf_')
  })
})

describe('normalizeNameForMCP — claude.ai prefix special handling', () => {
  test('collapses consecutive underscores after replacement', () => {
    // "claude.ai my server" → spaces replaced → "claude_ai_my_server" then dots = "_"
    // Wait: "claude.ai " starts the prefix; without prefix, "claude.ai my" stays as compounded underscores.
    // With prefix "claude.ai " (trailing space), enable the collapse path.
    expect(normalizeNameForMCP('claude.ai a..b')).toBe('claude_ai_a_b')
  })
  test('strips leading underscores when claude.ai prefix', () => {
    // Leading dots → underscores → stripped because of claude.ai branch
    expect(normalizeNameForMCP('claude.ai .name')).toBe('claude_ai_name')
  })
  test('strips trailing underscores when claude.ai prefix', () => {
    expect(normalizeNameForMCP('claude.ai name.')).toBe('claude_ai_name')
  })
  test('non-claude.ai names keep consecutive underscores', () => {
    expect(normalizeNameForMCP('foo..bar')).toBe('foo__bar')
  })
})
