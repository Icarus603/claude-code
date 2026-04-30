/**
 * Tests for parseSedEditCommand + isSedInPlaceEdit — pure parsers
 * that detect sed -i in-place file edits so the UI can render them
 * with file-edit-style diff display instead of bash-output style.
 *
 * Wrong parsing = sed edits render as terminal output (no diff
 * preview). Wrong file path extraction = wrong file shown in the
 * diff dialog.
 */
import { describe, expect, test } from 'bun:test'
import {
  isSedInPlaceEdit,
  parseSedEditCommand,
} from '../sedEditParser.js'

describe('parseSedEditCommand — basic recognition', () => {
  test('simple -i + s/x/y/ + file', () => {
    const r = parseSedEditCommand("sed -i 's/foo/bar/' file.txt")
    expect(r).not.toBeNull()
    expect(r?.filePath).toBe('file.txt')
    expect(r?.pattern).toBe('foo')
    expect(r?.replacement).toBe('bar')
    expect(r?.flags).toBe('')
  })

  test('with global flag g', () => {
    const r = parseSedEditCommand("sed -i 's/foo/bar/g' file.txt")
    expect(r?.flags).toBe('g')
  })

  test('with multiple flags gi', () => {
    const r = parseSedEditCommand("sed -i 's/foo/bar/gi' file.txt")
    expect(r?.flags).toBe('gi')
  })

  test('--in-place long flag accepted', () => {
    const r = parseSedEditCommand("sed --in-place 's/foo/bar/' file.txt")
    expect(r).not.toBeNull()
    expect(r?.filePath).toBe('file.txt')
  })

  test('-i.bak (inline backup suffix) accepted', () => {
    const r = parseSedEditCommand("sed -i.bak 's/foo/bar/' file.txt")
    expect(r).not.toBeNull()
    expect(r?.filePath).toBe('file.txt')
  })

  test('-i \'\' (macOS empty backup suffix) accepted', () => {
    const r = parseSedEditCommand("sed -i '' 's/foo/bar/' file.txt")
    expect(r).not.toBeNull()
    expect(r?.filePath).toBe('file.txt')
  })

  test('-E for extended regex flag', () => {
    const r = parseSedEditCommand("sed -i -E 's/foo+/bar/g' file.txt")
    expect(r?.extendedRegex).toBe(true)
  })

  test('-r alias for extended regex', () => {
    const r = parseSedEditCommand("sed -i -r 's/foo+/bar/g' file.txt")
    expect(r?.extendedRegex).toBe(true)
  })
})

describe('parseSedEditCommand — null cases', () => {
  test('not starting with sed → null', () => {
    expect(parseSedEditCommand("ls -la")).toBeNull()
  })

  test('sed without -i → null (not in-place edit)', () => {
    expect(parseSedEditCommand("sed 's/foo/bar/' file.txt")).toBeNull()
  })

  test('-i but no expression → null', () => {
    expect(parseSedEditCommand("sed -i file.txt")).toBeNull()
  })

  test('-i but no file path → null', () => {
    expect(parseSedEditCommand("sed -i 's/foo/bar/'")).toBeNull()
  })

  test('multiple files → null (not supported)', () => {
    expect(
      parseSedEditCommand("sed -i 's/foo/bar/' a.txt b.txt"),
    ).toBeNull()
  })

  test('non-substitution expression (d for delete) → null', () => {
    expect(parseSedEditCommand("sed -i '/foo/d' file.txt")).toBeNull()
  })

  test('different delimiter (#, |, etc.) → null (only / supported)', () => {
    // Documented: only `/` delimiter supported for simplicity.
    expect(parseSedEditCommand("sed -i 's#foo#bar#' file.txt")).toBeNull()
  })

  test('unknown flag → null (safe rejection)', () => {
    expect(parseSedEditCommand("sed -i -x 's/foo/bar/' file.txt")).toBeNull()
  })

  test('multiple -e expressions → null', () => {
    expect(
      parseSedEditCommand("sed -i -e 's/foo/bar/' -e 's/baz/qux/' file.txt"),
    ).toBeNull()
  })

  test('invalid flag character (z) in flags → null', () => {
    expect(parseSedEditCommand("sed -i 's/foo/bar/z' file.txt")).toBeNull()
  })

  test('incomplete expression (missing replacement section) → null', () => {
    expect(parseSedEditCommand("sed -i 's/foo' file.txt")).toBeNull()
  })

  test('empty command → null', () => {
    expect(parseSedEditCommand("")).toBeNull()
  })
})

describe('parseSedEditCommand — escaping', () => {
  test('escaped slash in pattern preserved', () => {
    const r = parseSedEditCommand("sed -i 's/foo\\/bar/baz/' file.txt")
    expect(r).not.toBeNull()
    // pattern includes the escape sequence as-is
    expect(r?.pattern).toContain('foo')
  })

  test('escaped slash in replacement preserved', () => {
    const r = parseSedEditCommand("sed -i 's/foo/bar\\/baz/' file.txt")
    expect(r).not.toBeNull()
    expect(r?.replacement).toContain('bar')
  })
})

describe('parseSedEditCommand — -e flag', () => {
  test('-e expression form', () => {
    const r = parseSedEditCommand("sed -i -e 's/foo/bar/' file.txt")
    expect(r?.pattern).toBe('foo')
    expect(r?.replacement).toBe('bar')
  })

  test('--expression= long form', () => {
    const r = parseSedEditCommand(
      "sed -i --expression=s/foo/bar/ file.txt",
    )
    expect(r).not.toBeNull()
    expect(r?.pattern).toBe('foo')
  })
})

describe('isSedInPlaceEdit', () => {
  test('valid sed -i → true', () => {
    expect(isSedInPlaceEdit("sed -i 's/foo/bar/' file.txt")).toBe(true)
  })

  test('non-sed command → false', () => {
    expect(isSedInPlaceEdit("rm file.txt")).toBe(false)
  })

  test('sed without -i → false', () => {
    expect(isSedInPlaceEdit("sed 's/foo/bar/' file.txt")).toBe(false)
  })

  test('returns boolean (never undefined)', () => {
    expect(typeof isSedInPlaceEdit("sed -i 's/x/y/' f")).toBe('boolean')
    expect(typeof isSedInPlaceEdit("rm")).toBe('boolean')
  })
})

describe('parseSedEditCommand — leading whitespace', () => {
  test('leading whitespace tolerated', () => {
    expect(parseSedEditCommand("  sed -i 's/foo/bar/' file.txt")).not.toBeNull()
  })

  test('tab-indented sed command', () => {
    expect(parseSedEditCommand("\tsed -i 's/foo/bar/' file.txt")).not.toBeNull()
  })
})

describe('parseSedEditCommand — pattern complexity', () => {
  test('regex metacharacters in pattern preserved', () => {
    const r = parseSedEditCommand("sed -i 's/^foo$/bar/g' file.txt")
    expect(r?.pattern).toBe('^foo$')
  })

  test('special chars in replacement preserved', () => {
    const r = parseSedEditCommand("sed -i 's/foo/bar &/g' file.txt")
    expect(r?.replacement).toBe('bar &')
  })

  test('numeric flag (e.g., g flag plus 1-9) accepted', () => {
    // Flags can be g, p, i, I, m, M, 1-9
    const r = parseSedEditCommand("sed -i 's/foo/bar/2' file.txt")
    expect(r).not.toBeNull()
    expect(r?.flags).toBe('2')
  })
})
