import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractRespawnArgs,
  resolveJobShort,
  splitBgArgs,
  tailFile,
} from '../bg.js'

const mkJob = (short: string, status: 'running' | 'exited' = 'exited') => ({
  short,
  pid: 1,
  cmd: ['x'] as const,
  cwd: '/',
  startedAt: 1,
  status,
})

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'bg-test-'))
  mkdirSync(workDir, { recursive: true })
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

const writeLog = (name: string, content: string): string => {
  const p = join(workDir, name)
  writeFileSync(p, content)
  return p
}

describe('tailFile', () => {
  test('returns empty for nonexistent file', () => {
    expect(tailFile(join(workDir, 'no-such-file'), 10)).toBe('')
  })

  test('returns empty for zero/negative line count', () => {
    const p = writeLog('a.log', 'one\ntwo\nthree\n')
    expect(tailFile(p, 0)).toBe('')
    expect(tailFile(p, -1)).toBe('')
  })

  test('returns empty for empty file', () => {
    const p = writeLog('empty.log', '')
    expect(tailFile(p, 5)).toBe('')
  })

  test('preserves no-trailing-newline file shape', () => {
    const p = writeLog('no-trail.log', 'a\nb\nc')
    expect(tailFile(p, 2)).toBe('b\nc')
  })

  test('preserves trailing-newline file shape', () => {
    const p = writeLog('trail.log', 'a\nb\nc\n')
    expect(tailFile(p, 2)).toBe('b\nc\n')
  })

  test('returns whole file when requested tail exceeds line count', () => {
    const p = writeLog('small.log', 'x\ny\nz\n')
    expect(tailFile(p, 1000)).toBe('x\ny\nz\n')
  })

  test('handles single-line file (no internal newlines)', () => {
    const p = writeLog('single-noterm.log', 'just one line')
    expect(tailFile(p, 5)).toBe('just one line')
    const p2 = writeLog('single-term.log', 'just one line\n')
    expect(tailFile(p2, 5)).toBe('just one line\n')
  })

  test('handles a 1000-line file with a small tail', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => String(i + 1))
    const p = writeLog('big.log', lines.join('\n') + '\n')
    expect(tailFile(p, 5)).toBe('996\n997\n998\n999\n1000\n')
  })

  test('handles content larger than the 64 KB chunk', () => {
    // 100k lines × ~7 bytes = ~700 KB → well past CHUNK boundary
    const lines = Array.from({ length: 100_000 }, (_, i) => `line${i}`)
    const p = writeLog('huge.log', lines.join('\n') + '\n')
    const tail = tailFile(p, 3)
    expect(tail).toBe('line99997\nline99998\nline99999\n')
  })

  test('handles tail-count exactly matching line count', () => {
    const p = writeLog('exact.log', 'a\nb\nc\n')
    expect(tailFile(p, 3)).toBe('a\nb\nc\n')
  })
})

describe('splitBgArgs', () => {
  test('strips --bg, treats single positional as directive', () => {
    expect(splitBgArgs(['--bg', 'task'])).toEqual({
      flags: [],
      directive: 'task',
    })
  })

  test('multiple positionals join with spaces', () => {
    expect(splitBgArgs(['--bg', 'do', 'the', 'thing'])).toEqual({
      flags: [],
      directive: 'do the thing',
    })
  })

  test('preserves unknown flags as forwarded flags', () => {
    expect(splitBgArgs(['--bg', '--debug', 'task'])).toEqual({
      flags: ['--debug'],
      directive: 'task',
    })
  })

  test('flag-with-value pulls the value into flags array', () => {
    expect(
      splitBgArgs(['--bg', '--model', 'claude-haiku-4-5', 'task']),
    ).toEqual({
      flags: ['--model', 'claude-haiku-4-5'],
      directive: 'task',
    })
  })

  test('flag=value form is self-contained', () => {
    expect(splitBgArgs(['--bg', '--model=claude-haiku-4-5', 'task'])).toEqual({
      flags: ['--model=claude-haiku-4-5'],
      directive: 'task',
    })
  })

  test('--permission-mode auto with --bg recognised as flag-with-value', () => {
    expect(
      splitBgArgs(['--bg', '--permission-mode', 'auto', 'task']),
    ).toEqual({
      flags: ['--permission-mode', 'auto'],
      directive: 'task',
    })
  })

  test('content after `--` is positional even if it starts with -', () => {
    expect(
      splitBgArgs(['--bg', '--model', 'opus', '--', '--literal-text']),
    ).toEqual({
      flags: ['--model', 'opus'],
      directive: '--literal-text',
    })
  })

  test('--bg with no directive returns empty directive', () => {
    expect(splitBgArgs(['--bg', '--debug'])).toEqual({
      flags: ['--debug'],
      directive: '',
    })
  })

  test('-bg variant also stripped', () => {
    expect(splitBgArgs(['-bg', 'task'])).toEqual({
      flags: [],
      directive: 'task',
    })
  })

  test('--background variant also stripped', () => {
    expect(splitBgArgs(['--background', 'task'])).toEqual({
      flags: [],
      directive: 'task',
    })
  })

  test('mixed flags and positionals — flag value not eaten as positional', () => {
    // `--model claude-haiku` consumes `claude-haiku` as the model value;
    // remaining `task` is the directive.
    expect(
      splitBgArgs([
        '--bg',
        '--model',
        'claude-haiku-4-5',
        '--debug',
        'task',
      ]),
    ).toEqual({
      flags: ['--model', 'claude-haiku-4-5', '--debug'],
      directive: 'task',
    })
  })

  test('unknown flag with positional next — positional NOT consumed', () => {
    // `--unknown-flag` isn't in BG_FLAGS_WITH_VALUE, so the next arg
    // stays in positionals.
    expect(splitBgArgs(['--bg', '--unknown-flag', 'task'])).toEqual({
      flags: ['--unknown-flag'],
      directive: 'task',
    })
  })
})

describe('resolveJobShort', () => {
  test('empty prefix returns "none"', () => {
    expect(resolveJobShort('', [mkJob('aaa')])).toEqual({ error: 'none' })
  })

  test('exact match wins over a prefix match', () => {
    const exactJob = mkJob('abc')
    const prefixJob = mkJob('abcdef')
    const result = resolveJobShort('abc', [exactJob, prefixJob])
    expect(result).toEqual({ job: exactJob })
  })

  test('unique prefix returns the single job', () => {
    const job = mkJob('xyz123')
    expect(resolveJobShort('xyz', [job])).toEqual({ job })
  })

  test('no match returns "none"', () => {
    expect(resolveJobShort('zzz', [mkJob('aaa'), mkJob('bbb')])).toEqual({
      error: 'none',
    })
  })

  test('ambiguous prefix returns "ambiguous" with all matches', () => {
    const a = mkJob('abc111')
    const b = mkJob('abc222')
    const result = resolveJobShort('abc', [a, b])
    expect(result).toEqual({ error: 'ambiguous', matches: [a, b] })
  })

  test('exact match disambiguates even when prefix would match more', () => {
    const exact = mkJob('abc')
    const longer = mkJob('abcdef')
    expect(resolveJobShort('abc', [exact, longer])).toEqual({ job: exact })
  })

  test('handles empty job list', () => {
    expect(resolveJobShort('abc', [])).toEqual({ error: 'none' })
  })
})

describe('extractRespawnArgs', () => {
  test('bun-launched cmd with flags + directive', () => {
    expect(
      extractRespawnArgs([
        'bun',
        '/path/to/cli.js',
        '--model',
        'claude-haiku-4-5',
        '-p',
        'do the thing',
      ]),
    ).toEqual({
      flags: ['--model', 'claude-haiku-4-5'],
      directive: 'do the thing',
    })
  })

  test('compiled-binary cmd (no bun prefix)', () => {
    expect(
      extractRespawnArgs(['/usr/local/bin/ccb', '--debug', '-p', 'task']),
    ).toEqual({
      flags: ['--debug'],
      directive: 'task',
    })
  })

  test('legacy meta with no flags (just `-p directive`)', () => {
    expect(
      extractRespawnArgs(['bun', '/path/to/cli.js', '-p', 'just a task']),
    ).toEqual({
      flags: [],
      directive: 'just a task',
    })
  })

  test('directive containing multiple words rejoined with spaces', () => {
    expect(
      extractRespawnArgs(['bun', '/cli.js', '-p', 'word1 word2 word3']),
    ).toEqual({
      flags: [],
      directive: 'word1 word2 word3',
    })
  })

  test('returns null when -p marker is missing', () => {
    expect(extractRespawnArgs(['bun', '/cli.js', '--debug'])).toBeNull()
  })

  test('returns null when -p is the last element (no directive)', () => {
    expect(extractRespawnArgs(['bun', '/cli.js', '-p'])).toBeNull()
  })

  test('uses lastIndexOf so a `-p` inside flags does not confuse parsing', () => {
    // Hypothetical: a flag with `-p` as its value (highly unlikely with
    // BG_FLAGS_WITH_VALUE consumption in splitBgArgs, but extract from
    // raw cmd should still pick the LAST -p as the directive marker).
    expect(
      extractRespawnArgs([
        'bun',
        '/cli.js',
        '--some-flag',
        '-p',
        '-p',
        'real directive',
      ]),
    ).toEqual({
      flags: ['--some-flag', '-p'],
      directive: 'real directive',
    })
  })

  test('unwraps a pty-mode cmd (REPL with positional directive)', () => {
    // pty cmd uses the FULL REPL (no -p), directive is positional.
    expect(
      extractRespawnArgs([
        'bun',
        '/cli.js',
        '--bg-pty-host',
        '/tmp/x.sock',
        '200',
        '50',
        '--',
        'bun',
        '/cli.js',
        '--debug',
        'do the thing',
      ]),
    ).toEqual({
      flags: ['--debug'],
      directive: 'do the thing',
    })
  })

  test('unwraps a pty-mode cmd from compiled binary (no inner bun)', () => {
    expect(
      extractRespawnArgs([
        '/usr/local/bin/ccb',
        '--bg-pty-host',
        '/tmp/x.sock',
        '80',
        '24',
        '--',
        '/usr/local/bin/ccb',
        '--model',
        'opus',
        'task',
      ]),
    ).toEqual({
      flags: ['--model', 'opus'],
      directive: 'task',
    })
  })

  test('returns null on pty wrapper with missing -- separator', () => {
    expect(
      extractRespawnArgs(['bun', '/cli.js', '--bg-pty-host', '/tmp/s']),
    ).toBeNull()
  })

  test('returns null on pty cmd with no positional directive', () => {
    expect(
      extractRespawnArgs([
        'bun',
        '/cli.js',
        '--bg-pty-host',
        '/tmp/s',
        '80',
        '24',
        '--',
        'bun',
        '/cli.js',
        '--debug',
      ]),
    ).toBeNull()
  })
})
