/**
 * Tests for claudemd.ts pure helpers — high-traffic memory-file logic
 * that decides what gets injected into the system prompt.
 *
 * Why this matters: a wrong "isMemoryFilePath" misses CLAUDE.md edits and
 * the user sees stale injection. Wrong stripHtmlComments either swallows
 * the entire file (bad) or leaves authorial notes leaking into the prompt
 * (also bad). Wrong getLargeMemoryFiles silently truncates context.
 */
import { describe, expect, test } from 'bun:test'
import { sep } from 'node:path'
import {
  getLargeMemoryFiles,
  isMemoryFilePath,
  MAX_MEMORY_CHARACTER_COUNT,
  stripHtmlComments,
  type MemoryFileInfo,
} from '../claudemd.js'

describe('stripHtmlComments — basic shapes', () => {
  test('content with no comment marker returns identity', () => {
    const { content, stripped } = stripHtmlComments('Hello world\n')
    expect(content).toBe('Hello world\n')
    expect(stripped).toBe(false)
  })

  test('block-level comment is stripped', () => {
    const { content, stripped } = stripHtmlComments(
      '<!-- author note -->\n# Heading\n',
    )
    expect(content).not.toContain('author note')
    expect(stripped).toBe(true)
    expect(content).toContain('# Heading')
  })

  test('multi-line block comment is stripped', () => {
    const { content, stripped } = stripHtmlComments(
      '<!--\n  multi-line\n  note\n-->\n# After\n',
    )
    expect(content).not.toContain('multi-line')
    expect(stripped).toBe(true)
    expect(content).toContain('# After')
  })

  test('two block comments are both stripped', () => {
    const { content, stripped } = stripHtmlComments(
      '<!-- one -->\n<!-- two -->\n# Heading\n',
    )
    expect(content).not.toContain('one')
    expect(content).not.toContain('two')
    expect(stripped).toBe(true)
  })

  test('residual content after comment on same line is preserved', () => {
    // Per the doc: `<!-- note --> Use bun` keeps "Use bun"
    const { content } = stripHtmlComments('<!-- note --> Use bun\n')
    expect(content).toContain('Use bun')
    expect(content).not.toContain('note')
  })
})

describe('stripHtmlComments — preservation', () => {
  test('inline comment inside paragraph is left intact', () => {
    // Inline HTML comments inside paragraphs (not block-level) survive.
    const input = 'Plain text <!-- inline --> still here.\n'
    const { content } = stripHtmlComments(input)
    expect(content).toContain('<!-- inline -->')
  })

  test('comment inside fenced code block is preserved', () => {
    const input = '```\n<!-- preserved -->\n```\n'
    const { content } = stripHtmlComments(input)
    expect(content).toContain('<!-- preserved -->')
  })

  test('comment inside indented code block is preserved', () => {
    const input = '    <!-- preserved -->\n'
    const { content } = stripHtmlComments(input)
    expect(content).toContain('<!-- preserved -->')
  })

  test('unclosed comment is left in place (doc behavior)', () => {
    // From the docstring: "Unclosed comments (`<!--` with no matching
    // `-->`) are left in place so a typo doesn't silently swallow the
    // rest of the file."
    const input = '<!-- never closed\n# Heading kept anyway\n'
    const { content, stripped } = stripHtmlComments(input)
    expect(content).toContain('# Heading kept anyway')
    expect(stripped).toBe(false)
  })
})

describe('stripHtmlComments — empty / edge inputs', () => {
  test('empty string returns empty', () => {
    const { content, stripped } = stripHtmlComments('')
    expect(content).toBe('')
    expect(stripped).toBe(false)
  })

  test('only a comment leaves empty output', () => {
    const { content, stripped } = stripHtmlComments('<!-- only -->\n')
    expect(content.trim()).toBe('')
    expect(stripped).toBe(true)
  })

  test('mixed CRLF + LF preserved when no comment present', () => {
    // Important: marked normalises \r\n during lex, but the no-comment
    // fast path returns the original content untouched (the function
    // returns identity when "<!--" is not present).
    const input = 'a\r\nb\nc\r\n'
    const { content, stripped } = stripHtmlComments(input)
    expect(content).toBe(input)
    expect(stripped).toBe(false)
  })
})

describe('isMemoryFilePath', () => {
  test('CLAUDE.md returns true', () => {
    expect(isMemoryFilePath('/repo/CLAUDE.md')).toBe(true)
  })

  test('CLAUDE.local.md returns true', () => {
    expect(isMemoryFilePath('/repo/CLAUDE.local.md')).toBe(true)
  })

  test('CLAUDE.md in nested dir returns true', () => {
    expect(isMemoryFilePath('/repo/a/b/c/CLAUDE.md')).toBe(true)
  })

  test('plain README.md returns false', () => {
    expect(isMemoryFilePath('/repo/README.md')).toBe(false)
  })

  test('claude.md (lowercase) returns false', () => {
    // Case-sensitive — CLAUDE only.
    expect(isMemoryFilePath('/repo/claude.md')).toBe(false)
  })

  test('.claude/rules/foo.md returns true', () => {
    const p = `/repo${sep}.claude${sep}rules${sep}foo.md`
    expect(isMemoryFilePath(p)).toBe(true)
  })

  test('.claude/agents/foo.md (not rules/) returns false', () => {
    const p = `/repo${sep}.claude${sep}agents${sep}foo.md`
    expect(isMemoryFilePath(p)).toBe(false)
  })

  test('rules/foo.md without .claude/ parent returns false', () => {
    // Must be inside .claude/rules/ specifically.
    const p = `/repo${sep}rules${sep}foo.md`
    expect(isMemoryFilePath(p)).toBe(false)
  })

  test('non-md extension in .claude/rules/ returns false', () => {
    const p = `/repo${sep}.claude${sep}rules${sep}foo.txt`
    expect(isMemoryFilePath(p)).toBe(false)
  })

  test('empty string returns false', () => {
    expect(isMemoryFilePath('')).toBe(false)
  })
})

function makeFile(content: string): MemoryFileInfo {
  return {
    path: '/p/CLAUDE.md',
    type: 'Project',
    content,
  }
}

describe('getLargeMemoryFiles', () => {
  test('empty list returns empty', () => {
    expect(getLargeMemoryFiles([])).toEqual([])
  })

  test('all small files returns empty', () => {
    const files = [makeFile('hi'), makeFile('also short')]
    expect(getLargeMemoryFiles(files)).toEqual([])
  })

  test('exactly at threshold is NOT large (filter is strict >)', () => {
    const files = [makeFile('a'.repeat(MAX_MEMORY_CHARACTER_COUNT))]
    expect(getLargeMemoryFiles(files)).toEqual([])
  })

  test('one byte over threshold IS large', () => {
    const files = [makeFile('a'.repeat(MAX_MEMORY_CHARACTER_COUNT + 1))]
    expect(getLargeMemoryFiles(files)).toHaveLength(1)
  })

  test('mixed sizes returns only large ones', () => {
    const small = makeFile('small')
    const large = makeFile('a'.repeat(MAX_MEMORY_CHARACTER_COUNT + 100))
    expect(getLargeMemoryFiles([small, large])).toEqual([large])
  })
})
