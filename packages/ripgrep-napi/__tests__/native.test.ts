/**
 * Tests for ripgrep-napi. Exercises the JS wrapper end-to-end against the
 * loaded .node binary on the current platform. Cross-platform .node files
 * are produced by GHA and tested by the same suite running on each runner.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  countFiles,
  findFiles,
  searchContent,
  searchStream,
} from '../src/index.js'

function makeTempTree(layout: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rgnapi-test-'))
  for (const [rel, content] of Object.entries(layout)) {
    const full = join(dir, rel)
    const parent = full.substring(0, full.lastIndexOf('/'))
    mkdirSync(parent, { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

describe('findFiles', () => {
  test('lists files at the root, hidden ignored by default', () => {
    const root = makeTempTree({
      'a.ts': '',
      'b.md': '',
      '.hidden': '',
    })
    try {
      const files = findFiles({ root, noIgnore: true }).sort()
      expect(files).toHaveLength(2)
      expect(files.some(f => f.endsWith('a.ts'))).toBe(true)
      expect(files.some(f => f.endsWith('b.md'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('hidden:true includes dotfiles', () => {
    const root = makeTempTree({ 'a.ts': '', '.dot': '' })
    try {
      const files = findFiles({ root, hidden: true, noIgnore: true })
      expect(files).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('globs filter by pattern', () => {
    const root = makeTempTree({
      'a.ts': '',
      'b.md': '',
      'sub/c.md': '',
    })
    try {
      const md = findFiles({ root, globs: ['*.md'], noIgnore: true }).sort()
      expect(md).toHaveLength(2)
      expect(md.every(f => f.endsWith('.md'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('negation glob excludes', () => {
    const root = makeTempTree({
      'a.ts': '',
      'sub/b.ts': '',
      'sub/c.ts': '',
    })
    try {
      const files = findFiles({
        root,
        globs: ['!sub/**'],
        noIgnore: true,
      })
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/a\.ts$/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('maxDepth limits recursion', () => {
    const root = makeTempTree({
      'a.ts': '',
      'sub/b.ts': '',
      'sub/sub2/c.ts': '',
    })
    try {
      const shallow = findFiles({ root, maxDepth: 1, noIgnore: true })
      expect(shallow).toHaveLength(1)
      expect(shallow[0]).toMatch(/a\.ts$/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('missing root returns empty array (not throw)', () => {
    expect(findFiles({ root: '/nonexistent/path/here' })).toEqual([])
  })
})

describe('countFiles', () => {
  test('counts files matching options', () => {
    const root = makeTempTree({ 'a.ts': '', 'b.ts': '', 'c.ts': '' })
    try {
      expect(countFiles({ root, noIgnore: true })).toBe(3)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('searchContent', () => {
  test('finds regex matches across files', () => {
    const root = makeTempTree({
      'a.ts': 'export function alpha() {}\nfn helper() {}',
      'b.ts': 'export function beta() {}',
    })
    try {
      const matches = searchContent({
        root,
        pattern: 'export function',
        noIgnore: true,
      })
      expect(matches).toHaveLength(2)
      expect(matches[0].content).toContain('export function')
      expect(matches[0].lineNumber).toBeGreaterThan(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('case insensitive', () => {
    const root = makeTempTree({ 'a.ts': 'HELLO world\nhello again' })
    try {
      const matches = searchContent({
        root,
        pattern: 'hello',
        caseInsensitive: true,
        noIgnore: true,
      })
      expect(matches).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('literal flag treats regex chars as text', () => {
    const root = makeTempTree({ 'a.ts': 'foo.bar\nfoozbar' })
    try {
      const matches = searchContent({
        root,
        pattern: 'foo.bar',
        literal: true,
        noIgnore: true,
      })
      expect(matches).toHaveLength(1)
      expect(matches[0].content).toContain('foo.bar')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('maxCountPerFile caps results per file', () => {
    const root = makeTempTree({
      'a.ts': 'hello\nhello\nhello\nhello',
    })
    try {
      const matches = searchContent({
        root,
        pattern: 'hello',
        maxCountPerFile: 2,
        noIgnore: true,
      })
      expect(matches).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('no matches returns empty array', () => {
    const root = makeTempTree({ 'a.ts': 'foo' })
    try {
      const matches = searchContent({
        root,
        pattern: 'will-not-match',
        noIgnore: true,
      })
      expect(matches).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('searchStream', () => {
  test('emits one onMatch per match, then onDone once', async () => {
    const root = makeTempTree({
      'a.ts': 'hello\nworld\nhello',
      'b.ts': 'hello',
    })
    try {
      const matches: string[] = []
      let doneCount = 0
      const handle = searchStream(
        { root, pattern: 'hello', noIgnore: true },
        line => matches.push(line),
        () => doneCount++,
      )
      // Wait for done.
      await new Promise(r => setTimeout(r, 200))
      expect(handle).toHaveProperty('cancel')
      expect(matches).toHaveLength(3)
      expect(matches.every(l => l.includes('hello'))).toBe(true)
      expect(doneCount).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('cancel stops emission and triggers onDone', async () => {
    // The stream walker checks the cancel flag both at walker and
    // sink granularity. We don't test exact match counts (search can
    // finish faster than the cancel timeout for small trees), but
    // calling cancel() must always still trigger onDone, and the
    // CancelHandle must expose a `.cancel` callable.
    const root = makeTempTree({
      'f.ts': 'pattern\n'.repeat(20),
    })
    try {
      let done = false
      const handle = searchStream(
        { root, pattern: 'pattern', noIgnore: true },
        () => {},
        () => {
          done = true
        },
      )
      expect(typeof handle.cancel).toBe('function')
      handle.cancel() // safe to call before, during, or after search
      await new Promise<void>(r => {
        const iv = setInterval(() => {
          if (done) {
            clearInterval(iv)
            r()
          }
        }, 5)
      })
      expect(done).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('format is path:lineNumber:content', async () => {
    const root = makeTempTree({ 'a.ts': 'first\nsecond\nthird' })
    try {
      const matches: string[] = []
      let done = false
      searchStream(
        { root, pattern: 'second', noIgnore: true },
        line => matches.push(line),
        () => {
          done = true
        },
      )
      await new Promise<void>(r => {
        const iv = setInterval(() => {
          if (done) {
            clearInterval(iv)
            r()
          }
        }, 5)
      })
      expect(matches).toHaveLength(1)
      expect(matches[0]).toMatch(/^.+\/a\.ts:2:second$/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
