/**
 * Tests for the REPL→FleetView bridge seed derivation (ant fV6 port).
 * Pure-function tests + state.json shape for the empty-intent idle path.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildReplForkFlags,
  deriveReplSeed,
  IDLE_DETAIL,
  NEEDS_SEND_PROMPT,
  preSeedReplBgJob,
} from '../replBridgeSeed.js'

// Minimal Message factories matching ccb's shape (message.message.content).
function userMsg(text: string, isMeta = false): any {
  return {
    type: 'user',
    isMeta: isMeta ? true : undefined,
    message: { role: 'user', content: text },
  }
}
function assistantMsg(text: string): any {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  }
}

describe('deriveReplSeed', () => {
  test('returns null when no user message and no override', () => {
    expect(deriveReplSeed([])).toBeNull()
    expect(deriveReplSeed([assistantMsg('hi')])).toBeNull()
  })

  test('takes most recent user text as intent, assistant as detail', () => {
    const seed = deriveReplSeed([
      userMsg('first task'),
      assistantMsg('working on it, here is a long answer'),
      userMsg('second task'),
      assistantMsg('done with second'),
    ])
    expect(seed).not.toBeNull()
    // Reverse scan: most-recent user = "second task", most-recent assistant
    // = "done with second".
    expect(seed!.intent).toBe('second task')
    expect(seed!.detail).toBe('done with second')
  })

  test('intent sliced to 200, detail whitespace-collapsed + sliced to 120', () => {
    const longUser = 'x'.repeat(300)
    const longAsst = 'a\n\n   b\t\tc ' + 'y'.repeat(300)
    const seed = deriveReplSeed([userMsg(longUser), assistantMsg(longAsst)])
    expect(seed!.intent.length).toBe(200)
    expect(seed!.detail!.length).toBe(120)
    // whitespace collapsed: no double spaces / tabs / newlines
    expect(seed!.detail).not.toMatch(/\s{2,}/)
    expect(seed!.detail!.startsWith('a b c')).toBe(true)
  })

  test('override wins as intent and forces non-null even with no user msg', () => {
    const seed = deriveReplSeed([assistantMsg('only assistant')], 'forced')
    expect(seed).not.toBeNull()
    expect(seed!.intent).toBe('forced')
    expect(seed!.detail).toBe('only assistant')
  })

  test('skips meta user messages', () => {
    const seed = deriveReplSeed([
      userMsg('real task'),
      userMsg('<meta caveat>', true),
    ])
    expect(seed!.intent).toBe('real task')
  })

  test('empty user text falls back to (backgrounded)', () => {
    // A user message with whitespace-only content → no intent → default.
    const seed = deriveReplSeed([userMsg('   ')], 'x')
    // override 'x' wins
    expect(seed!.intent).toBe('x')
    // without override, whitespace-only user yields no foundUser → null
    expect(deriveReplSeed([userMsg('   ')])).toBeNull()
  })
})

describe('buildReplForkFlags', () => {
  const CUR = '35894943-c5e0-45a0-9484-f113daa5835b'
  const FORK = 'b0649465-7e3f-4475-bd55-3c15811d7608'

  test('transcript exists → resume + fork-session + session-id, in that order', () => {
    const flags = buildReplForkFlags(CUR, FORK, true)
    expect(flags).toEqual([
      '--resume',
      CUR,
      '--fork-session',
      '--session-id',
      FORK,
    ])
  })

  test('INVARIANT: never carries a positional prompt (no re-run)', () => {
    // The whole bug was the worker re-running the last user message. The flag
    // list must never contain a `--` separator nor any bare positional — the
    // directive is passed separately as '' so the worker inherits, not reruns.
    for (const tx of [true, false]) {
      const flags = buildReplForkFlags(CUR, FORK, tx)
      expect(flags).not.toContain('--')
      expect(flags).not.toContain('-p')
      // every element is either a known flag or one of the two known ids.
      const allowed = new Set([
        '--resume',
        '--fork-session',
        '--session-id',
        CUR,
        FORK,
      ])
      for (const f of flags) expect(allowed.has(f)).toBe(true)
    }
  })

  test('INVARIANT: forked worker id is always pushed (no orphan)', () => {
    // ant i1O:124 always appends --session-id. Missing it → worker self-gens a
    // UUID and the FleetView row / job dir desync into an orphan.
    expect(buildReplForkFlags(CUR, FORK, true)).toContain('--session-id')
    expect(buildReplForkFlags(CUR, FORK, true)).toContain(FORK)
    expect(buildReplForkFlags(CUR, FORK, false)).toContain('--session-id')
    expect(buildReplForkFlags(CUR, FORK, false)).toContain(FORK)
  })

  test('no transcript yet → fresh worker (session-id only, no --resume)', () => {
    // A brand-new session with no flushed turn has nothing to inherit; ant
    // gates --resume on the transcript file existing (J = await qOH(j)).
    const flags = buildReplForkFlags(CUR, FORK, false)
    expect(flags).toEqual(['--session-id', FORK])
    expect(flags).not.toContain('--resume')
    expect(flags).not.toContain('--fork-session')
  })

  test('resume always pairs with fork-session (never resumes in place)', () => {
    // Resuming WITHOUT --fork-session would make the worker reuse the
    // foreground session id and contend for its transcript file. The two must
    // always travel together (ant MV6 emits them as a unit).
    const flags = buildReplForkFlags(CUR, FORK, true)
    const ri = flags.indexOf('--resume')
    const fi = flags.indexOf('--fork-session')
    expect(ri).toBeGreaterThanOrEqual(0)
    expect(fi).toBeGreaterThanOrEqual(0)
    // --resume <id> then --fork-session
    expect(flags[ri + 1]).toBe(CUR)
    expect(fi).toBeGreaterThan(ri)
  })
})

describe('preSeedReplBgJob', () => {
  test('empty intent → blocked + needs="send a prompt to start"', async () => {
    const root = mkdtempSync(join(tmpdir(), 'preseed-'))
    const orig = process.env.CLAUDE_CONFIG_HOME
    process.env.CLAUDE_CONFIG_HOME = root
    try {
      const { short, jobDir } = await preSeedReplBgJob('abcdef0123456789', {
        cwd: '/tmp/work',
      })
      expect(short).toBe('abcdef01')
      const state = JSON.parse(
        readFileSync(join(jobDir, 'state.json'), 'utf8'),
      )
      // status is always 'working' (worker IS running); idle-ness is in tempo.
      // ant's empty-intent job: state.state==="working" + tempo treatment.
      expect(state.tempo).toBe('blocked')
      expect(state.state).toBe('working')
      expect(state.needs).toBe(NEEDS_SEND_PROMPT)
      expect(state.detail).toBe(IDLE_DETAIL)
      expect(state.intent).toBe('')
      expect(state.template).toBe('bg')
      expect(state.backend).toBe('daemon')
      expect(state.sessionId).toBe('abcdef0123456789')
      expect(state.cwd).toBe('/tmp/work')
    } finally {
      if (orig === undefined) delete process.env.CLAUDE_CONFIG_HOME
      else process.env.CLAUDE_CONFIG_HOME = orig
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('non-empty intent → active, no needs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'preseed-'))
    const orig = process.env.CLAUDE_CONFIG_HOME
    process.env.CLAUDE_CONFIG_HOME = root
    try {
      const { jobDir } = await preSeedReplBgJob('11112222deadbeef', {
        cwd: '/tmp/work',
        intent: 'fix the parser',
        detail: 'last assistant reply',
      })
      const state = JSON.parse(
        readFileSync(join(jobDir, 'state.json'), 'utf8'),
      )
      expect(state.tempo).toBe('active')
      expect(state.state).toBe('working')
      expect(state.needs).toBeUndefined()
      expect(state.intent).toBe('fix the parser')
      expect(state.detail).toBe('last assistant reply')
    } finally {
      if (orig === undefined) delete process.env.CLAUDE_CONFIG_HOME
      else process.env.CLAUDE_CONFIG_HOME = orig
      rmSync(root, { recursive: true, force: true })
    }
  })
})
