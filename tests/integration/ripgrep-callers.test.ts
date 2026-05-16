/**
 * Integration tests covering every consumer of ripgrep.ts.
 *
 * Goal: prove that ccb's existing call-shape contract still holds after
 * the spawn-based implementation was replaced with the NAPI module. Each
 * caller is exercised against a real temporary tree, not mocked.
 *
 * The matrix matches the ripgrep-callers inventory in the plan file:
 *   - markdownConfigLoader (~/.claude/<subdir>/*.md loader)
 *   - GrepTool (content search)
 *   - storage glob (file-pattern search)
 *   - fileSuggestions (REPL @-mention typeahead)
 *   - orphanedPluginFilter (plugin cache deny markers)
 *   - countFilesRoundedRg (telemetry rounded count)
 *   - ripGrepStream (GlobalSearchDialog backing)
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  countFilesRoundedRg,
  ripGrep,
  ripGrepStream,
} from '@claude-code/tool-registry/ripgrep.js'

function makeTempTree(layout: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rgcallers-'))
  for (const [rel, content] of Object.entries(layout)) {
    const full = join(dir, rel)
    const parent = full.substring(0, full.lastIndexOf('/'))
    mkdirSync(parent, { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

describe('ripgrep callers (post-NAPI)', () => {
  test('markdownConfigLoader-style call: --files --hidden --follow --no-ignore --glob *.md', async () => {
    const root = makeTempTree({
      'a.md': 'one',
      'b.md': 'two',
      'c.txt': 'skip',
      'sub/.hidden.md': 'hidden md',
    })
    try {
      const args = [
        '--files',
        '--hidden',
        '--follow',
        '--no-ignore',
        '--glob',
        '*.md',
      ]
      const files = await ripGrep(args, root, new AbortController().signal)
      expect(files.length).toBeGreaterThanOrEqual(2)
      expect(files.every(f => f.endsWith('.md'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('GrepTool-style content search returns path:line:content', async () => {
    const root = makeTempTree({
      'a.ts': 'export function alpha() {}\n',
      'b.ts': 'export function beta() {}\n',
    })
    try {
      const args = ['--hidden', '-n', '-e', 'export function']
      const lines = await ripGrep(args, root, new AbortController().signal)
      expect(lines).toHaveLength(2)
      expect(lines.every(l => /:\d+:export function/.test(l))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('GrepTool -l (files-with-matches) mode returns paths', async () => {
    const root = makeTempTree({
      'a.ts': 'foo\nbar\nfoo',
      'b.ts': 'baz',
    })
    try {
      const args = ['--hidden', '-l', '-e', 'foo']
      const paths = await ripGrep(args, root, new AbortController().signal)
      expect(paths).toHaveLength(1)
      expect(paths[0]).toMatch(/a\.ts$/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('GrepTool -o (only matching) mode returns matched text only', async () => {
    const root = makeTempTree({ 'a.ts': 'abc123 xyz456\nno digits' })
    try {
      const args = ['--hidden', '-n', '-o', '-e', '\\d+']
      const lines = await ripGrep(args, root, new AbortController().signal)
      expect(lines).toHaveLength(2)
      expect(lines.every(l => /:\d+:\d+$/.test(l))).toBe(true)
      expect(lines.some(l => l.endsWith(':123'))).toBe(true)
      expect(lines.some(l => l.endsWith(':456'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('GrepTool -c (count) mode returns path:count', async () => {
    const root = makeTempTree({
      'a.ts': 'foo\nfoo\nfoo',
      'b.ts': 'foo\nbar',
    })
    try {
      const args = ['--hidden', '-c', '-e', 'foo']
      const lines = await ripGrep(args, root, new AbortController().signal)
      expect(lines).toHaveLength(2)
      const counts = new Map(
        lines.map(l => {
          const idx = l.lastIndexOf(':')
          return [l.substring(0, idx), parseInt(l.substring(idx + 1))]
        }),
      )
      const aCount = [...counts.entries()].find(([p]) =>
        p.endsWith('a.ts'),
      )?.[1]
      const bCount = [...counts.entries()].find(([p]) =>
        p.endsWith('b.ts'),
      )?.[1]
      expect(aCount).toBe(3)
      expect(bCount).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('storage/glob-style call: --files --glob pattern --no-ignore', async () => {
    const root = makeTempTree({
      'a.ts': '',
      'b.md': '',
      'sub/c.ts': '',
    })
    try {
      const args = ['--files', '--glob', '*.ts', '--no-ignore', '--hidden']
      const files = await ripGrep(args, root, new AbortController().signal)
      expect(files.length).toBeGreaterThanOrEqual(2)
      expect(files.every(f => f.endsWith('.ts'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('fileSuggestions-style call: --files --follow --hidden + VCS exclude globs', async () => {
    const root = makeTempTree({
      'a.ts': '',
      'b.ts': '',
      '.git/HEAD': 'ref: ...',
      '.svn/entries': '',
    })
    try {
      const args = [
        '--files',
        '--follow',
        '--hidden',
        '--glob',
        '!.git/',
        '--glob',
        '!.svn/',
        '--no-ignore-vcs',
      ]
      const files = await ripGrep(args, root, new AbortController().signal)
      expect(files.length).toBeGreaterThanOrEqual(2)
      expect(
        files.every(f => !f.includes('/.git/') && !f.includes('/.svn/')),
      ).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('orphanedPluginFilter-style call: --files --hidden --no-ignore --max-depth 4 --glob marker', async () => {
    const root = makeTempTree({
      'mkt/plugin/v1/.orphaned_at': '',
      'mkt/plugin/v2/something.txt': '',
      'too/deep/inside/another/.orphaned_at': '',
    })
    try {
      const args = [
        '--files',
        '--hidden',
        '--no-ignore',
        '--max-depth',
        '4',
        '--glob',
        '.orphaned_at',
      ]
      const markers = await ripGrep(args, root, new AbortController().signal)
      expect(markers.length).toBeGreaterThan(0)
      expect(markers.every(m => m.endsWith('.orphaned_at'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('countFilesRoundedRg returns power-of-10 rounded count', async () => {
    // Build 42 files so the rounding actually visible: power=10,
    // round(42/10)*10 = 40. (For counts < 10 the rounding is a no-op
    // because the magnitude is 1, matching the legacy ant behavior.)
    const root = makeTempTree(
      Object.fromEntries(
        Array.from({ length: 42 }, (_, i) => [`f${i}.ts`, '']),
      ),
    )
    try {
      const count = await countFilesRoundedRg(
        root,
        new AbortController().signal,
        [],
      )
      expect(count).toBe(40)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('ripGrepStream-style streaming search emits path:line:content', async () => {
    const root = makeTempTree({
      'a.ts': 'first\nsecond\nthird',
      'b.ts': 'second_only',
    })
    try {
      const collected: string[] = []
      await ripGrepStream(
        ['-n', '--no-heading', '-e', 'second'],
        root,
        new AbortController().signal,
        lines => collected.push(...lines),
      )
      expect(collected.length).toBeGreaterThanOrEqual(1)
      // Format should be path:line:content (line number a real positive int).
      expect(collected[0]).toMatch(/.+:\d+:second/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('ripGrep returns empty array on missing target without throwing', async () => {
    const result = await ripGrep(
      ['--files'],
      '/nonexistent/path/here/no-really',
      new AbortController().signal,
    )
    expect(result).toEqual([])
  })

  test('ripGrep with -i flag is case-insensitive', async () => {
    const root = makeTempTree({ 'a.ts': 'HELLO\nhello' })
    try {
      const args = ['--hidden', '-i', '-e', 'hello']
      const lines = await ripGrep(args, root, new AbortController().signal)
      expect(lines).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('ripGrep with -F treats pattern as literal', async () => {
    const root = makeTempTree({ 'a.ts': 'foo.bar\nfoozbar' })
    try {
      const args = ['--hidden', '-F', '-e', 'foo.bar']
      const lines = await ripGrep(args, root, new AbortController().signal)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('foo.bar')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
