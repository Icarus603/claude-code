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
  test('lists files at the root, hidden ignored by default', async () => {
    const root = makeTempTree({
      'a.ts': '',
      'b.md': '',
      '.hidden': '',
    })
    try {
      const files = (await findFiles({ root, noIgnore: true })).sort()
      expect(files).toHaveLength(2)
      expect(files.some(f => f.endsWith('a.ts'))).toBe(true)
      expect(files.some(f => f.endsWith('b.md'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('hidden:true includes dotfiles', async () => {
    const root = makeTempTree({ 'a.ts': '', '.dot': '' })
    try {
      const files = await findFiles({ root, hidden: true, noIgnore: true })
      expect(files).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('globs filter by pattern', async () => {
    const root = makeTempTree({
      'a.ts': '',
      'b.md': '',
      'sub/c.md': '',
    })
    try {
      const md = (
        await findFiles({ root, globs: ['*.md'], noIgnore: true })
      ).sort()
      expect(md).toHaveLength(2)
      expect(md.every(f => f.endsWith('.md'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('negation glob excludes', async () => {
    const root = makeTempTree({
      'a.ts': '',
      'sub/b.ts': '',
      'sub/c.ts': '',
    })
    try {
      const files = await findFiles({
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

  test('maxDepth limits recursion', async () => {
    const root = makeTempTree({
      'a.ts': '',
      'sub/b.ts': '',
      'sub/sub2/c.ts': '',
    })
    try {
      const shallow = await findFiles({ root, maxDepth: 1, noIgnore: true })
      expect(shallow).toHaveLength(1)
      expect(shallow[0]).toMatch(/a\.ts$/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('missing root returns empty array (not throw)', async () => {
    expect(await findFiles({ root: '/nonexistent/path/here' })).toEqual([])
  })

  test('returns a Promise (does not block the JS event loop)', async () => {
    // Regression: when `find_files` was a synchronous NAPI call, the
    // walker ran on the JS main thread and froze Bun's event loop for
    // the duration of the walk (~2.5s on a 1.7M-file home directory).
    // The fix is `async fn` on the Rust side + spawn_blocking onto
    // tokio's blocking pool. Verifying the JS-visible shape (a thenable)
    // pins the contract regardless of how fast the walk happens to be
    // for the fixture under test.
    const root = makeTempTree({ 'a.ts': '' })
    try {
      const result = findFiles({ root, noIgnore: true })
      expect(typeof (result as Promise<string[]>).then).toBe('function')
      const files = await result
      expect(files).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('countFiles', () => {
  test('counts files matching options', async () => {
    const root = makeTempTree({ 'a.ts': '', 'b.ts': '', 'c.ts': '' })
    try {
      expect(await countFiles({ root, noIgnore: true })).toBe(3)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('searchContent', () => {
  test('finds regex matches across files', async () => {
    const root = makeTempTree({
      'a.ts': 'export function alpha() {}\nfn helper() {}',
      'b.ts': 'export function beta() {}',
    })
    try {
      const matches = await searchContent({
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

  test('case insensitive', async () => {
    const root = makeTempTree({ 'a.ts': 'HELLO world\nhello again' })
    try {
      const matches = await searchContent({
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

  test('literal flag treats regex chars as text', async () => {
    const root = makeTempTree({ 'a.ts': 'foo.bar\nfoozbar' })
    try {
      const matches = await searchContent({
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

  test('maxCountPerFile caps results per file', async () => {
    const root = makeTempTree({
      'a.ts': 'hello\nhello\nhello\nhello',
    })
    try {
      const matches = await searchContent({
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

  test('no matches returns empty array', async () => {
    const root = makeTempTree({ 'a.ts': 'foo' })
    try {
      const matches = await searchContent({
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

// ---------------------------------------------------------------------------
// rg-equivalence regression tests. Each pins a divergence from the spawned
// `rg` binary that ccb's earlier hand-built GlobSet implementation got
// wrong. These were found by diffing NAPI output against system `rg` on a
// real .git repo; see __tests__/equiv-probe*.ts for the diff harnesses.
// ---------------------------------------------------------------------------
describe('rg-equivalence regressions', () => {
  // P0: VCS-directory exclusion. GrepTool/Glob push `!.git` (etc.) to
  // exclude version-control noise, and always pass --hidden (which kills
  // the hidden-file filter). The old GlobSet turned `!.git` into a no-op
  // that matched only a path whose final component was exactly `.git`, so
  // `.git/config` and every other VCS-internal file leaked into results.
  // OverrideBuilder gives gitignore semantics: `!.git` excludes the whole
  // subtree. This test would FAIL (return .git/* entries) under the old impl.
  test('!.git excludes the entire .git subtree (not just a path named .git)', async () => {
    const root = makeTempTree({
      'a.ts': 'foo',
      '.git/config': 'foo',
      '.git/hooks/pre-commit': 'foo',
      'sub/.git/cfg': 'foo',
      'sub/b.ts': 'foo',
    })
    try {
      const files = await findFiles({
        root,
        globs: ['!.git'],
        hidden: true,
        noIgnore: true,
      })
      const rels = files.map(f => f.slice(root.length + 1)).sort()
      expect(rels).toEqual(['a.ts', 'sub/b.ts'])
      // Belt-and-suspenders: no entry under any .git dir survived.
      expect(rels.some(r => r.includes('.git/'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('searchContent honors !.git exclusion (content does not leak)', async () => {
    const root = makeTempTree({
      'a.ts': 'secret',
      '.git/config': 'secret',
    })
    try {
      const matches = await searchContent({
        root,
        pattern: 'secret',
        globs: ['!.git'],
        hidden: true,
        noIgnore: true,
      })
      const paths = matches.map(m => m.path.slice(root.length + 1))
      expect(paths).toEqual(['a.ts'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // Bare glob (no slash) matches at any depth — gitignore semantics. The
  // old impl required a `**/` prefix to achieve this; OverrideBuilder does
  // it natively, which is why ripgrep.ts no longer string-rewrites globs.
  test('bare glob *.ts matches at any depth', async () => {
    const root = makeTempTree({
      'a.ts': '',
      'sub/b.ts': '',
      'sub/deep/c.ts': '',
      'd.md': '',
    })
    try {
      const files = await findFiles({
        root,
        globs: ['*.ts'],
        hidden: true,
        noIgnore: true,
      })
      const rels = files.map(f => f.slice(root.length + 1)).sort()
      expect(rels).toEqual(['a.ts', 'sub/b.ts', 'sub/deep/c.ts'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // P1: --type filter. GrepTool advertises `type: js/py/rust/...` in its
  // schema and pushes --type, but it used to be parsed JS-side and dropped
  // — a no-op. Now wired through TypesBuilder.add_defaults().
  test('fileTypes restricts to ripgrep built-in types', async () => {
    const root = makeTempTree({
      'a.ts': 'x',
      'b.py': 'x',
      'c.md': 'x',
      'd.rs': 'x',
    })
    try {
      const ts = await findFiles({
        root,
        fileTypes: ['ts'],
        hidden: true,
        noIgnore: true,
      })
      expect(ts.map(f => f.slice(root.length + 1))).toEqual(['a.ts'])

      const multi = (
        await findFiles({
          root,
          fileTypes: ['py', 'rust'],
          hidden: true,
          noIgnore: true,
        })
      )
        .map(f => f.slice(root.length + 1))
        .sort()
      expect(multi).toEqual(['b.py', 'd.rs'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('unknown fileType degrades gracefully (no throw, filter dropped)', async () => {
    const root = makeTempTree({ 'a.ts': '', 'b.py': '' })
    try {
      // A typo'd type ("typescript" instead of "ts") arrives from an LLM
      // tool call. rg would hard-error; we drop the filter and list all,
      // which is the safer failure for an agent loop.
      const files = await findFiles({
        root,
        fileTypes: ['notarealtype'],
        hidden: true,
        noIgnore: true,
      })
      expect(files).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // P2: max-columns must not drop a file from -l whose only match is on an
  // over-long line. The native side emits a membership stub (empty content,
  // columnTruncated=true) so files-with-matches / count callers still see
  // the file, mirroring `rg -l`/`rg -c`.
  test('maxColumns keeps file membership via columnTruncated stub', async () => {
    const root = makeTempTree({
      'x.ts': `short foo\n${'y'.repeat(600)} foo\nfoo end\n`,
    })
    try {
      const matches = await searchContent({
        root,
        pattern: 'foo',
        maxColumns: 500,
        hidden: true,
        noIgnore: true,
      })
      // 3 matches total; the middle one is column-truncated with empty body.
      expect(matches).toHaveLength(3)
      const trunc = matches.filter(m => m.columnTruncated)
      expect(trunc).toHaveLength(1)
      expect(trunc[0].content).toBe('')
      // -l membership: file still present despite the long-only match.
      const files = new Set(matches.map(m => m.path))
      expect(files.size).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // P2: context lines -A/-B/-C. Used to be silently skipped. Now wired via
  // SearcherBuilder before/after_context + Sink::context. Context entries
  // carry isContext=true; the group-break sentinel has lineNumber absent
  // (napi maps None -> undefined) and content '--'.
  test('context lines are emitted with isContext + group-break sentinel', async () => {
    const root = makeTempTree({
      'f.ts': 'l1\nl2\nMATCH-a\nl4\nl5\nl6\nMATCH-b\nl8\n',
    })
    try {
      const m = await searchContent({
        root,
        pattern: 'MATCH',
        beforeContext: 1,
        afterContext: 1,
        hidden: true,
        noIgnore: true,
      })
      // Reduce to (lineNumber, kind) ignoring the sentinel's path noise.
      const shape = m.map(x =>
        x.lineNumber == null && x.content === '--'
          ? '--'
          : `${x.lineNumber}${x.isContext ? 'C' : 'M'}`,
      )
      // l2(ctx) MATCH-a l4(ctx) -- l6(ctx) MATCH-b l8(ctx)
      expect(shape).toEqual(['2C', '3M', '4C', '--', '6C', '7M', '8C'])
      // Real matches (excluding context + sentinel) = 2.
      const realMatches = m.filter(
        x => !x.isContext && !(x.lineNumber == null),
      )
      expect(realMatches).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('-A and -B asymmetric context', async () => {
    const root = makeTempTree({ 'f.ts': 'a\nb\nHIT\nc\nd\n' })
    try {
      const after = await searchContent({
        root,
        pattern: 'HIT',
        afterContext: 2,
        hidden: true,
        noIgnore: true,
      })
      expect(after.map(x => x.lineNumber)).toEqual([3, 4, 5])
      expect(after.map(x => x.isContext)).toEqual([false, true, true])

      const before = await searchContent({
        root,
        pattern: 'HIT',
        beforeContext: 1,
        hidden: true,
        noIgnore: true,
      })
      expect(before.map(x => x.lineNumber)).toEqual([2, 3])
      expect(before.map(x => x.isContext)).toEqual([true, false])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
