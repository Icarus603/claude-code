/**
 * Tests for extractGlobBaseDirectory — pure helper that splits a
 * glob pattern into a static base directory + a relative pattern
 * suitable for ripgrep's --glob flag (which requires relative
 * patterns even when the user gave us an absolute pattern).
 *
 * Wrong split = ripgrep searches the wrong directory:
 * - "/etc/*.conf" must search /etc with pattern "*.conf"
 * - "src/**\/*.ts" must search "src" with pattern "**\/*.ts"
 * - "*.md" with no separator must search cwd
 *
 * Edge cases include literal paths (no glob chars), Windows drive
 * roots (C:/), and root patterns (/).
 */
import { describe, expect, test } from 'bun:test'
import { extractGlobBaseDirectory } from '../glob.js'

describe('extractGlobBaseDirectory — basic glob patterns', () => {
  test('relative pattern with separator', () => {
    expect(extractGlobBaseDirectory('src/*.ts')).toEqual({
      baseDir: 'src',
      relativePattern: '*.ts',
    })
  })

  test('deep relative pattern', () => {
    expect(extractGlobBaseDirectory('a/b/c/*.ts')).toEqual({
      baseDir: 'a/b/c',
      relativePattern: '*.ts',
    })
  })

  test('pattern with **', () => {
    expect(extractGlobBaseDirectory('src/**/*.ts')).toEqual({
      baseDir: 'src',
      relativePattern: '**/*.ts',
    })
  })

  test('pattern with ? wildcard', () => {
    expect(extractGlobBaseDirectory('src/?.ts')).toEqual({
      baseDir: 'src',
      relativePattern: '?.ts',
    })
  })

  test('pattern with [...] character class', () => {
    expect(extractGlobBaseDirectory('src/[abc].ts')).toEqual({
      baseDir: 'src',
      relativePattern: '[abc].ts',
    })
  })

  test('pattern with {...} alternation', () => {
    expect(extractGlobBaseDirectory('src/{a,b}.ts')).toEqual({
      baseDir: 'src',
      relativePattern: '{a,b}.ts',
    })
  })
})

describe('extractGlobBaseDirectory — no separator before glob', () => {
  test('star at root → empty baseDir, full pattern as relative', () => {
    // Documented contract: when there's no path separator before the
    // first glob char, the pattern is relative to cwd → baseDir is ''.
    expect(extractGlobBaseDirectory('*.md')).toEqual({
      baseDir: '',
      relativePattern: '*.md',
    })
  })

  test('?abc pattern at root', () => {
    expect(extractGlobBaseDirectory('?abc.ts')).toEqual({
      baseDir: '',
      relativePattern: '?abc.ts',
    })
  })

  test('** at root', () => {
    expect(extractGlobBaseDirectory('**')).toEqual({
      baseDir: '',
      relativePattern: '**',
    })
  })
})

describe('extractGlobBaseDirectory — literal paths (no glob chars)', () => {
  test('literal file → dirname/basename split', () => {
    expect(extractGlobBaseDirectory('src/file.ts')).toEqual({
      baseDir: 'src',
      relativePattern: 'file.ts',
    })
  })

  test('bare filename → "." dirname + filename', () => {
    // path.dirname('foo.ts') === '.'
    expect(extractGlobBaseDirectory('foo.ts')).toEqual({
      baseDir: '.',
      relativePattern: 'foo.ts',
    })
  })

  test('absolute literal path', () => {
    expect(extractGlobBaseDirectory('/etc/passwd')).toEqual({
      baseDir: '/etc',
      relativePattern: 'passwd',
    })
  })
})

describe('extractGlobBaseDirectory — root patterns', () => {
  test('/*.txt → baseDir is /, pattern is *.txt', () => {
    // Documented contract: when lastSepIndex is 0, baseDir is empty
    // but we use '/' as the root.
    expect(extractGlobBaseDirectory('/*.txt')).toEqual({
      baseDir: '/',
      relativePattern: '*.txt',
    })
  })

  test('/**/*.ts → baseDir is /, pattern is **/*.ts', () => {
    expect(extractGlobBaseDirectory('/**/*.ts')).toEqual({
      baseDir: '/',
      relativePattern: '**/*.ts',
    })
  })

  test('absolute deep glob', () => {
    expect(extractGlobBaseDirectory('/usr/local/*.so')).toEqual({
      baseDir: '/usr/local',
      relativePattern: '*.so',
    })
  })
})

describe('extractGlobBaseDirectory — preserves separators correctly', () => {
  test('multiple consecutive slashes preserved (split at last)', () => {
    // path.lastIndexOf('/') uses the LAST slash, even after consecutive ones.
    expect(extractGlobBaseDirectory('a//b/*.ts')).toEqual({
      baseDir: 'a//b',
      relativePattern: '*.ts',
    })
  })

  test('trailing slash before glob → baseDir without trailing slash', () => {
    // 'src/' + '*.ts' → lastSepIndex = 3, baseDir = 'src'.
    expect(extractGlobBaseDirectory('src/*.ts')).toEqual({
      baseDir: 'src',
      relativePattern: '*.ts',
    })
  })
})

describe('extractGlobBaseDirectory — return shape', () => {
  test('always returns object with both keys', () => {
    const r = extractGlobBaseDirectory('src/*.ts')
    expect('baseDir' in r).toBe(true)
    expect('relativePattern' in r).toBe(true)
  })

  test('both fields are strings', () => {
    const r = extractGlobBaseDirectory('src/*.ts')
    expect(typeof r.baseDir).toBe('string')
    expect(typeof r.relativePattern).toBe('string')
  })

  test('non-empty pattern produces non-empty relative', () => {
    const r = extractGlobBaseDirectory('src/foo.ts')
    expect(r.relativePattern.length).toBeGreaterThan(0)
  })
})

describe('extractGlobBaseDirectory — glob char detected within path component', () => {
  test('glob in middle path component', () => {
    // 'src/foo*/bar.ts' — first glob char is at position 7 (the '*').
    // staticPrefix = 'src/foo'; lastSep at 3 → baseDir = 'src',
    // relative = 'foo*/bar.ts'.
    expect(extractGlobBaseDirectory('src/foo*/bar.ts')).toEqual({
      baseDir: 'src',
      relativePattern: 'foo*/bar.ts',
    })
  })

  test('glob char in filename only', () => {
    expect(extractGlobBaseDirectory('a/b/c?.txt')).toEqual({
      baseDir: 'a/b',
      relativePattern: 'c?.txt',
    })
  })

  test('curly brace alternation in middle', () => {
    expect(extractGlobBaseDirectory('a/{x,y}/file.ts')).toEqual({
      baseDir: 'a',
      relativePattern: '{x,y}/file.ts',
    })
  })
})

describe('extractGlobBaseDirectory — degenerate inputs', () => {
  test('empty string → no glob, empty input → bare dirname/basename', () => {
    // path.dirname('') === '.', path.basename('') === ''
    expect(extractGlobBaseDirectory('')).toEqual({
      baseDir: '.',
      relativePattern: '',
    })
  })

  test('single dot', () => {
    expect(extractGlobBaseDirectory('.')).toEqual({
      baseDir: '.',
      relativePattern: '.',
    })
  })

  test('trailing slash literal: path.dirname strips trailing slash', () => {
    // 'a/b/' has no glob; node's path.dirname strips trailing slash and
    // returns 'a' (not 'a/b'); path.basename returns 'b'. Locks the
    // path module behaviour.
    expect(extractGlobBaseDirectory('a/b/')).toEqual({
      baseDir: 'a',
      relativePattern: 'b',
    })
  })
})
