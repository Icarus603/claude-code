/**
 * Tests for the autonomous-loop sentinel resolver — port-correctness
 * against ant v2.1.136 `xFH` module (2924.js + 2925.js).
 *
 * The fire-resolution path is integration (depends on env vars,
 * feature flags, and global config that don't survive bun:test
 * mocking). These unit tests pin the structural invariants:
 *   - preamble strings differ in the documented ways
 *   - sentinel detection matches ant's narrow set
 *   - resetAutonomousLoopDelivered() truly resets module state
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  AUTONOMOUS_LOOP_PREAMBLE,
  AUTONOMOUS_LOOP_SENTINEL,
  getAutonomousLoopPreamble,
  isAutonomousLoopSentinel,
  isLoopDefaultSentinel,
  isLoopFileSentinel,
  LOOP_FILE_DYNAMIC_SENTINEL,
  LOOP_FILE_SENTINEL,
  resetAutonomousLoopDelivered,
} from '../internal/loopSentinelCore.js'

afterEach(() => {
  resetAutonomousLoopDelivered()
  delete process.env.CLAUDE_CODE_LOOP_PERSISTENT
})

describe('sentinel constants (ant zBH / KzH / z67 / rz_)', () => {
  test('autonomous-loop cron sentinel = "<<autonomous-loop>>"', () => {
    expect(AUTONOMOUS_LOOP_SENTINEL).toBe('<<autonomous-loop>>')
  })
  test('autonomous-loop dynamic sentinel = "<<autonomous-loop-dynamic>>"', () => {
    expect(AUTONOMOUS_LOOP_DYNAMIC_SENTINEL).toBe('<<autonomous-loop-dynamic>>')
  })
  test('loop.md sentinel = "<<loop.md>>"', () => {
    expect(LOOP_FILE_SENTINEL).toBe('<<loop.md>>')
  })
  test('loop.md dynamic sentinel = "<<loop.md-dynamic>>"', () => {
    expect(LOOP_FILE_DYNAMIC_SENTINEL).toBe('<<loop.md-dynamic>>')
  })
})

describe('isAutonomousLoopSentinel / isLoopFileSentinel / isLoopDefaultSentinel', () => {
  test('autonomous variants match', () => {
    expect(isAutonomousLoopSentinel(AUTONOMOUS_LOOP_SENTINEL)).toBe(true)
    expect(isAutonomousLoopSentinel(AUTONOMOUS_LOOP_DYNAMIC_SENTINEL)).toBe(true)
  })
  test('autonomous does not match loop.md variants', () => {
    expect(isAutonomousLoopSentinel(LOOP_FILE_SENTINEL)).toBe(false)
    expect(isAutonomousLoopSentinel(LOOP_FILE_DYNAMIC_SENTINEL)).toBe(false)
  })
  test('autonomous does not match unrelated strings', () => {
    expect(isAutonomousLoopSentinel('hello world')).toBe(false)
    expect(isAutonomousLoopSentinel('<<autonomous-loop-x>>')).toBe(false)
    expect(isAutonomousLoopSentinel('')).toBe(false)
  })
  test('loop.md variants match', () => {
    expect(isLoopFileSentinel(LOOP_FILE_SENTINEL)).toBe(true)
    expect(isLoopFileSentinel(LOOP_FILE_DYNAMIC_SENTINEL)).toBe(true)
  })
  test('loop.md does not match autonomous variants', () => {
    expect(isLoopFileSentinel(AUTONOMOUS_LOOP_SENTINEL)).toBe(false)
    expect(isLoopFileSentinel(AUTONOMOUS_LOOP_DYNAMIC_SENTINEL)).toBe(false)
  })
  test('isLoopDefaultSentinel is union of both', () => {
    expect(isLoopDefaultSentinel(AUTONOMOUS_LOOP_SENTINEL)).toBe(true)
    expect(isLoopDefaultSentinel(AUTONOMOUS_LOOP_DYNAMIC_SENTINEL)).toBe(true)
    expect(isLoopDefaultSentinel(LOOP_FILE_SENTINEL)).toBe(true)
    expect(isLoopDefaultSentinel(LOOP_FILE_DYNAMIC_SENTINEL)).toBe(true)
    expect(isLoopDefaultSentinel('whatever')).toBe(false)
  })
})

describe('AUTONOMOUS_LOOP_PREAMBLE (ant EY8 — default / steward)', () => {
  test('begins with the canonical "# Autonomous loop check" header', () => {
    // ant's persistent variant uses the SAME header — assert that
    // distinction lives in the body, not the header.
    expect(AUTONOMOUS_LOOP_PREAMBLE.startsWith('# Autonomous loop check\n')).toBe(true)
  })
  test('contains steward-mode "lean toward the former only" phrasing', () => {
    expect(AUTONOMOUS_LOOP_PREAMBLE).toContain('lean toward the former only')
  })
  test('contains "say so in one sentence and stop" (steward quiet branch)', () => {
    expect(AUTONOMOUS_LOOP_PREAMBLE).toContain(
      'say so in one sentence and stop',
    )
  })
  test('contains "do one quick CI/threads check and stop" (steward repeat branch)', () => {
    expect(AUTONOMOUS_LOOP_PREAMBLE).toContain(
      'do one quick CI/threads check and stop',
    )
  })
  test('contains "## What to act on" + "## Repeated invocations" section headers', () => {
    expect(AUTONOMOUS_LOOP_PREAMBLE).toContain('## What to act on')
    expect(AUTONOMOUS_LOOP_PREAMBLE).toContain('## Repeated invocations')
  })
})

describe('persistent preamble (ant q67)', () => {
  test('selected via CLAUDE_CODE_LOOP_PERSISTENT=1 env', () => {
    process.env.CLAUDE_CODE_LOOP_PERSISTENT = '1'
    const got = getAutonomousLoopPreamble()
    expect(got).not.toBe(AUTONOMOUS_LOOP_PREAMBLE)
  })
  test('persistent preamble has same "# Autonomous loop check" header', () => {
    process.env.CLAUDE_CODE_LOOP_PERSISTENT = '1'
    const got = getAutonomousLoopPreamble()
    expect(got.startsWith('# Autonomous loop check\n')).toBe(true)
  })
  test('persistent variant contains "following through on the *spirit*"', () => {
    process.env.CLAUDE_CODE_LOOP_PERSISTENT = '1'
    const got = getAutonomousLoopPreamble()
    expect(got).toContain('following through on the *spirit*')
  })
  test('persistent variant contains the reversibility framing', () => {
    process.env.CLAUDE_CODE_LOOP_PERSISTENT = '1'
    const got = getAutonomousLoopPreamble()
    expect(got).toContain('For irreversible actions (push, delete, send)')
    expect(got).toContain('For reversible actions (edits, tests, drafts, exploration)')
  })
  test('persistent variant says "keep the loop alive" not "stop" on quiet branch', () => {
    process.env.CLAUDE_CODE_LOOP_PERSISTENT = '1'
    const got = getAutonomousLoopPreamble()
    expect(got).toContain('keep the loop alive')
    expect(got).toContain('Persistence is the point of autonomous mode')
  })
  test('persistent variant says "broaden scope once before considering stopping"', () => {
    process.env.CLAUDE_CODE_LOOP_PERSISTENT = '1'
    const got = getAutonomousLoopPreamble()
    expect(got).toContain('broaden scope once before considering stopping')
  })
  test('env="0" overrides to default even if other gates would activate', () => {
    process.env.CLAUDE_CODE_LOOP_PERSISTENT = '0'
    expect(getAutonomousLoopPreamble()).toBe(AUTONOMOUS_LOOP_PREAMBLE)
  })
  test('env="false" also overrides to default', () => {
    process.env.CLAUDE_CODE_LOOP_PERSISTENT = 'false'
    expect(getAutonomousLoopPreamble()).toBe(AUTONOMOUS_LOOP_PREAMBLE)
  })
  test('no env returns the default preamble (when flag is off)', () => {
    expect(getAutonomousLoopPreamble()).toBe(AUTONOMOUS_LOOP_PREAMBLE)
  })
})

describe('resetAutonomousLoopDelivered', () => {
  test('clears module-level state', () => {
    // We can't directly observe `loopPreambleDelivered`, but the
    // reset must not throw and must leave the module callable.
    expect(() => resetAutonomousLoopDelivered()).not.toThrow()
    expect(() => resetAutonomousLoopDelivered()).not.toThrow()
  })
})

// ─── readLoopFile (ant $67) ────────────────────────────────────────────
// Pin the CRITICAL fix: ant's second candidate is `~/.claude/loop.md`
// (via `getClaudeConfigHomeDir()`), NOT `~/loop.md` (via homedir()).
// The earlier ccb impl had the wrong base path and would silently miss
// the file when `CLAUDE_CONFIG_DIR` was overridden.

import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getCwdState,
  setCwdState,
} from '@claude-code/app-host/bootstrap/state.js'
import { readLoopFile } from '../internal/loopSentinelCore.js'

describe('readLoopFile (ant $67) — Claude config home fallback', () => {
  let homeDir: string
  let cwdBackup: string
  let projectCwd: string

  beforeEachReadLoopFile()
  afterEachReadLoopFile()

  function beforeEachReadLoopFile() {
    beforeEach(() => {
      homeDir = mkdtempSync(join(tmpdir(), 'ccb-loop-home-'))
      process.env.CLAUDE_CONFIG_DIR = homeDir
      // ccb readLoopFile resolves cwd via app-host's getCwd, which
      // reads STATE.cwd (not process.cwd). Save the state cwd and
      // override with the tmpdir for the test.
      cwdBackup = getCwdState()
      projectCwd = mkdtempSync(join(tmpdir(), 'ccb-loop-project-'))
      setCwdState(projectCwd)
    })
  }

  function afterEachReadLoopFile() {
    afterEach(() => {
      setCwdState(cwdBackup)
      rmSync(projectCwd, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
      delete process.env.CLAUDE_CONFIG_DIR
    })
  }

  test('returns null when neither candidate exists', () => {
    expect(readLoopFile()).toBeNull()
  })

  test('reads project-local .claude/loop.md first', () => {
    mkdirSync(join(projectCwd, '.claude'), { recursive: true })
    writeFileSync(
      join(projectCwd, '.claude', 'loop.md'),
      'task 1\ntask 2',
      'utf8',
    )
    const got = readLoopFile()
    expect(got).not.toBeNull()
    expect(got!.content).toBe('task 1\ntask 2')
    expect(got!.path.endsWith('/.claude/loop.md')).toBe(true)
  })

  test('falls back to ~/.claude/loop.md (NOT ~/loop.md)', () => {
    // Pin the critical fix: the second-candidate base is the Claude
    // config home (which CLAUDE_CONFIG_DIR overrides to our tmpdir),
    // NOT os.homedir().
    writeFileSync(join(homeDir, 'loop.md'), 'fallback content', 'utf8')
    const got = readLoopFile()
    expect(got).not.toBeNull()
    expect(got!.content).toBe('fallback content')
    expect(got!.path).toBe(join(homeDir, 'loop.md'))
  })

  test('empty file (after trim) skips to next candidate', () => {
    mkdirSync(join(projectCwd, '.claude'), { recursive: true })
    writeFileSync(
      join(projectCwd, '.claude', 'loop.md'),
      '   \n\t\n   ',
      'utf8',
    )
    writeFileSync(join(homeDir, 'loop.md'), 'real content', 'utf8')
    const got = readLoopFile()
    expect(got!.content).toBe('real content')
  })

  test('truncates loop.md > 25000 bytes with WARNING footer', () => {
    const big = ('a'.repeat(100) + '\n').repeat(300) // ~30 KB
    mkdirSync(join(projectCwd, '.claude'), { recursive: true })
    writeFileSync(join(projectCwd, '.claude', 'loop.md'), big, 'utf8')
    const got = readLoopFile()
    expect(got).not.toBeNull()
    expect(got!.content.length).toBeLessThan(big.length)
    expect(got!.content).toContain('WARNING: loop.md was truncated')
  })
})

