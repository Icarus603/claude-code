import { describe, expect, test } from 'bun:test'
import { extractBashCommentLabel } from '../commentLabel.js'

describe('extractBashCommentLabel — basic', () => {
  test('extracts comment from single-line command', () => {
    expect(extractBashCommentLabel('# build the project\nnpm run build')).toBe(
      'build the project',
    )
  })

  test('extracts comment when no following line', () => {
    expect(extractBashCommentLabel('# just a comment')).toBe('just a comment')
  })

  test('strips leading # and whitespace', () => {
    expect(extractBashCommentLabel('#   leading spaces  \nls')).toBe(
      'leading spaces',
    )
  })

  test('handles multiple leading hashes ##', () => {
    expect(extractBashCommentLabel('## section header\nls')).toBe(
      'section header',
    )
  })

  test('handles ### or more', () => {
    expect(extractBashCommentLabel('### depth\nls')).toBe('depth')
  })

  test('trailing whitespace in label preserved (only leading stripped)', () => {
    // The replace `^#+\s*` only handles LEADING. Trailing whitespace is
    // already gone from `firstLine.trim()` at the start.
    const result = extractBashCommentLabel('#   hello   \nls')
    expect(result).toBe('hello')
  })
})

describe('extractBashCommentLabel — non-comment cases', () => {
  test('returns undefined when first line is not a comment', () => {
    expect(extractBashCommentLabel('ls -la')).toBeUndefined()
  })

  test('returns undefined for shebang #!', () => {
    // CRITICAL: #!/usr/bin/env bash is a shebang, NOT a comment label.
    // Catches refactor that uses `startsWith('#')` without the
    // `!startsWith('#!')` guard.
    expect(extractBashCommentLabel('#!/usr/bin/env bash\nls')).toBeUndefined()
  })

  test('returns undefined for shebang variants (#!python)', () => {
    expect(extractBashCommentLabel('#!python\nls')).toBeUndefined()
  })

  test('empty command returns undefined', () => {
    expect(extractBashCommentLabel('')).toBeUndefined()
  })

  test('whitespace-only command returns undefined', () => {
    expect(extractBashCommentLabel('   ')).toBeUndefined()
  })

  test('returns undefined for empty comment "#" alone', () => {
    // Comment with no content after # → empty string after trim →
    // returns undefined per `|| undefined`.
    expect(extractBashCommentLabel('#')).toBeUndefined()
  })

  test('returns undefined for "#  " (only whitespace after #)', () => {
    expect(extractBashCommentLabel('#   ')).toBeUndefined()
    expect(extractBashCommentLabel('#  \nls')).toBeUndefined()
  })

  test('mid-line # is NOT treated as comment', () => {
    // Only LEADING # at start of first line counts.
    expect(extractBashCommentLabel('ls # comment')).toBeUndefined()
  })

  test('comment after blank first line: line 2 # is NOT extracted', () => {
    // Function only looks at the first line. A comment on line 2 is
    // not a label (the empty first line dictates "no label").
    expect(extractBashCommentLabel('\n# this is line 2')).toBeUndefined()
  })
})

describe('extractBashCommentLabel — leading whitespace handling', () => {
  test('whitespace before # → still treated as comment (after trim)', () => {
    // firstLine is .trim()'d before the # check.
    expect(extractBashCommentLabel('   # padded comment\nls')).toBe(
      'padded comment',
    )
  })

  test('whitespace before #! → still treated as shebang (rejection)', () => {
    expect(
      extractBashCommentLabel('   #!/usr/bin/env bash\nls'),
    ).toBeUndefined()
  })
})

describe('extractBashCommentLabel — multi-line handling', () => {
  test('only the FIRST line determines the label', () => {
    expect(extractBashCommentLabel('# first label\n# second comment\nls')).toBe(
      'first label',
    )
  })

  test('first-line label preserved across many subsequent lines', () => {
    expect(extractBashCommentLabel('# label\nline1\nline2\nline3')).toBe(
      'label',
    )
  })

  test('handles \\r\\n line endings (Windows-style)', () => {
    // .indexOf('\n') finds the LF. Whether \r is part of the label
    // depends on the trim before checking. trim() removes \r.
    expect(extractBashCommentLabel('# label\r\nls')).toBe('label')
  })
})
