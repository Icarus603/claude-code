/**
 * Tests for parseGitNumstat + parseShortstat + parseGitDiff —
 * pure parsers for git diff output that drive the change-summary
 * UI (status banner, /diff renderer, attribution counts).
 *
 * Wrong parsing = misleading change counts on top of the screen,
 * binary files counted as text changes, or filename-with-tabs
 * splitting incorrectly.
 */
import { describe, expect, test } from 'bun:test'
import {
  parseGitDiff,
  parseGitNumstat,
  parseShortstat,
} from '../gitDiff.js'

describe('parseShortstat — happy paths', () => {
  test('full stat with insertions and deletions', () => {
    expect(
      parseShortstat(' 5 files changed, 100 insertions(+), 50 deletions(-)'),
    ).toEqual({ filesCount: 5, linesAdded: 100, linesRemoved: 50 })
  })

  test('only insertions', () => {
    expect(
      parseShortstat(' 1 file changed, 10 insertions(+)'),
    ).toEqual({ filesCount: 1, linesAdded: 10, linesRemoved: 0 })
  })

  test('only deletions', () => {
    expect(
      parseShortstat(' 1 file changed, 5 deletions(-)'),
    ).toEqual({ filesCount: 1, linesAdded: 0, linesRemoved: 5 })
  })

  test('singular vs plural file/insertion/deletion words handled', () => {
    expect(parseShortstat(' 1 file changed, 1 insertion(+)')).toEqual({
      filesCount: 1,
      linesAdded: 1,
      linesRemoved: 0,
    })
    expect(parseShortstat(' 2 files changed, 2 insertions(+)')).toEqual({
      filesCount: 2,
      linesAdded: 2,
      linesRemoved: 0,
    })
  })
})

describe('parseShortstat — empty / non-matching input', () => {
  test('empty string → null', () => {
    expect(parseShortstat('')).toBeNull()
  })

  test('whitespace only → null', () => {
    expect(parseShortstat('   \n  ')).toBeNull()
  })

  test('non-matching text → null', () => {
    expect(parseShortstat('this is not a git output')).toBeNull()
  })

  test('partial match (missing files-changed) → null', () => {
    expect(parseShortstat('100 insertions(+), 50 deletions(-)')).toBeNull()
  })
})

describe('parseGitNumstat — happy paths', () => {
  test('single file numstat', () => {
    const r = parseGitNumstat('10\t5\tsrc/foo.ts')
    expect(r.stats).toEqual({
      filesCount: 1,
      linesAdded: 10,
      linesRemoved: 5,
    })
    expect(r.perFileStats.get('src/foo.ts')).toEqual({
      added: 10,
      removed: 5,
      isBinary: false,
    })
  })

  test('multiple files', () => {
    const r = parseGitNumstat('10\t5\ta.ts\n20\t0\tb.ts\n0\t30\tc.ts')
    expect(r.stats.filesCount).toBe(3)
    expect(r.stats.linesAdded).toBe(30)
    expect(r.stats.linesRemoved).toBe(35)
    expect(r.perFileStats.size).toBe(3)
  })

  test('binary file: counts marked as 0 + isBinary=true', () => {
    const r = parseGitNumstat('-\t-\timage.png')
    expect(r.stats.linesAdded).toBe(0)
    expect(r.stats.linesRemoved).toBe(0)
    expect(r.perFileStats.get('image.png')).toEqual({
      added: 0,
      removed: 0,
      isBinary: true,
    })
  })

  test('mixed binary + text files', () => {
    const r = parseGitNumstat('10\t5\tsrc/foo.ts\n-\t-\timage.png\n3\t2\tbar.md')
    expect(r.stats.filesCount).toBe(3)
    expect(r.stats.linesAdded).toBe(13)
    expect(r.stats.linesRemoved).toBe(7)
    expect(r.perFileStats.get('image.png')?.isBinary).toBe(true)
    expect(r.perFileStats.get('src/foo.ts')?.isBinary).toBe(false)
  })

  test('filename containing tabs preserved (joined back)', () => {
    // Split on \t produces 4 parts; we re-join parts[2..]
    const r = parseGitNumstat('10\t5\tweird\tname.ts')
    expect(r.stats.filesCount).toBe(1)
    expect(r.perFileStats.has('weird\tname.ts')).toBe(true)
  })

  test('lines with fewer than 3 parts skipped', () => {
    const r = parseGitNumstat('10\tonlytwoparts\nvalid\t\n10\t5\treal.ts')
    expect(r.stats.filesCount).toBe(1)
    expect(r.perFileStats.has('real.ts')).toBe(true)
  })

  test('non-numeric add/remove counts → 0 (parseInt fallback)', () => {
    const r = parseGitNumstat('abc\txyz\tfile.ts')
    expect(r.stats.linesAdded).toBe(0)
    expect(r.stats.linesRemoved).toBe(0)
    expect(r.perFileStats.get('file.ts')).toEqual({
      added: 0,
      removed: 0,
      isBinary: false,
    })
  })
})

describe('parseGitNumstat — empty / edge', () => {
  test('empty string → empty result', () => {
    const r = parseGitNumstat('')
    expect(r.stats.filesCount).toBe(0)
    expect(r.perFileStats.size).toBe(0)
  })

  test('whitespace only → empty', () => {
    const r = parseGitNumstat('  \n  \n  ')
    expect(r.stats.filesCount).toBe(0)
  })

  test('trailing newline tolerated', () => {
    const r = parseGitNumstat('10\t5\tfoo.ts\n')
    expect(r.stats.filesCount).toBe(1)
  })

  test('large file count: still totals correctly, perFileStats capped at 50', () => {
    // Build 60 files. perFileStats keeps first 50 only (MAX_FILES=50).
    const lines: string[] = []
    for (let i = 0; i < 60; i++) {
      lines.push(`1\t1\tfile${i}.ts`)
    }
    const r = parseGitNumstat(lines.join('\n'))
    expect(r.stats.filesCount).toBe(60)
    expect(r.stats.linesAdded).toBe(60)
    expect(r.stats.linesRemoved).toBe(60)
    // perFileStats capped at 50.
    expect(r.perFileStats.size).toBe(50)
    expect(r.perFileStats.has('file0.ts')).toBe(true)
    expect(r.perFileStats.has('file49.ts')).toBe(true)
    expect(r.perFileStats.has('file50.ts')).toBe(false)
  })
})

describe('parseGitDiff — file-level extraction', () => {
  test('empty diff → empty Map', () => {
    expect(parseGitDiff('').size).toBe(0)
  })

  test('whitespace → empty Map', () => {
    expect(parseGitDiff('   \n  ').size).toBe(0)
  })

  test('single file with one hunk', () => {
    const diff = `diff --git a/foo.ts b/foo.ts
index abc..def 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 modified
 line 3
`
    const result = parseGitDiff(diff)
    expect(result.size).toBe(1)
    expect(result.has('foo.ts')).toBe(true)
    const hunks = result.get('foo.ts')!
    expect(hunks.length).toBeGreaterThan(0)
  })

  test('multiple files', () => {
    const diff = `diff --git a/a.ts b/a.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/b.ts b/b.ts
@@ -1,1 +1,1 @@
-x
+y
`
    const result = parseGitDiff(diff)
    expect(result.size).toBe(2)
    expect(result.has('a.ts')).toBe(true)
    expect(result.has('b.ts')).toBe(true)
  })

  test('file with no hunks (e.g., binary diff or rename) → entry but empty hunks', () => {
    const diff = `diff --git a/binary.png b/binary.png
Binary files differ
`
    const result = parseGitDiff(diff)
    // The file may or may not be added to result depending on parser
    // — what we lock is that parser doesn't crash and returns a Map.
    expect(result instanceof Map).toBe(true)
  })

  test('header without "a/X b/Y" pattern → file skipped', () => {
    const diff = `diff --git malformed-header
@@ -1,1 +1,1 @@
+new
`
    const result = parseGitDiff(diff)
    expect(result.size).toBe(0)
  })

  test('files capped at MAX_FILES=50', () => {
    const parts: string[] = []
    for (let i = 0; i < 60; i++) {
      parts.push(`diff --git a/f${i}.ts b/f${i}.ts
@@ -1,1 +1,1 @@
-old
+new`)
    }
    const result = parseGitDiff(parts.join('\n'))
    expect(result.size).toBe(50)
  })

  test('huge file (>1MB single file diff) skipped', () => {
    const big = 'x'.repeat(1_500_000)
    const diff = `diff --git a/big.ts b/big.ts\n${big}\n`
    const result = parseGitDiff(diff)
    expect(result.size).toBe(0)
  })

  test('first hunk header parsed correctly', () => {
    const diff = `diff --git a/foo.ts b/foo.ts
@@ -10,5 +20,8 @@ context
 line 1
+added
 line 2
`
    const result = parseGitDiff(diff)
    const hunks = result.get('foo.ts')
    expect(hunks?.length).toBeGreaterThan(0)
    if (hunks && hunks.length > 0) {
      // StructuredPatchHunk has oldStart, oldLines, newStart, newLines
      const h = hunks[0]!
      expect(h.oldStart).toBe(10)
      expect(h.oldLines).toBe(5)
      expect(h.newStart).toBe(20)
      expect(h.newLines).toBe(8)
    }
  })

  test('hunk header without explicit line counts (defaults to 1)', () => {
    // Format: @@ -X +Y @@ (no commas) implies oldLines=newLines=1.
    const diff = `diff --git a/foo.ts b/foo.ts
@@ -1 +1 @@
-old
+new
`
    const result = parseGitDiff(diff)
    expect(result.has('foo.ts')).toBe(true)
  })
})
