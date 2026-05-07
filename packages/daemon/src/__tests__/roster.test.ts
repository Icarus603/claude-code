import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  emptyRoster,
  getRosterPath,
  readRoster,
  recordToRosterEntry,
  updateRoster,
  writeRoster,
} from '../roster.js'

const DAEMON_DIR = join(homedir(), '.claude', 'daemon')

function clearDaemonDir(): void {
  try {
    for (const f of readdirSync(DAEMON_DIR)) {
      if (f.startsWith('roster.json')) {
        rmSync(join(DAEMON_DIR, f), { force: true })
      }
    }
  } catch {}
  mkdirSync(DAEMON_DIR, { recursive: true, mode: 0o700 })
}

beforeEach(clearDaemonDir)
afterEach(clearDaemonDir)

describe('emptyRoster', () => {
  test('returns shape with proto + supervisorPid + workers={}', () => {
    const r = emptyRoster()
    expect(r.proto).toBeGreaterThan(0)
    expect(r.supervisorPid).toBe(process.pid)
    expect(r.workers).toEqual({})
  })
})

describe('readRoster', () => {
  test('missing file → emptyRoster', () => {
    const r = readRoster()
    expect(r.workers).toEqual({})
    expect(r.parseFailed).toBeUndefined()
  })

  test('valid roster round-trips through readRoster', () => {
    const original = emptyRoster()
    original.workers['abc12345'] = {
      pid: 1234,
      startedAt: 1_700_000_000_000,
      attempt: 0,
      cwd: '/tmp',
      ptySock: '/tmp/foo.sock',
    }
    writeRoster(original)
    const loaded = readRoster()
    expect(loaded.workers['abc12345']?.pid).toBe(1234)
    expect(loaded.workers['abc12345']?.cwd).toBe('/tmp')
    expect(loaded.parseFailed).toBeUndefined()
  })

  test('corrupt JSON quarantines + returns parseFailed', () => {
    writeFileSync(getRosterPath(), '{not json')
    const r = readRoster()
    expect(r.parseFailed).toBe(true)
    expect(existsSync(getRosterPath())).toBe(false)
    const corrupt = readdirSync(DAEMON_DIR).filter(f =>
      f.startsWith('roster.json.corrupt.'),
    )
    expect(corrupt.length).toBeGreaterThan(0)
  })

  test('schema mismatch quarantines + returns parseFailed', () => {
    writeFileSync(
      getRosterPath(),
      JSON.stringify({ proto: 1, supervisorPid: 'not-a-number', workers: {} }),
    )
    const r = readRoster()
    expect(r.parseFailed).toBe(true)
    expect(existsSync(getRosterPath())).toBe(false)
  })

  test('silent:true skips quarantine on parse error', () => {
    writeFileSync(getRosterPath(), '{not json')
    const r = readRoster({ silent: true })
    expect(r.parseFailed).toBe(true)
    expect(existsSync(getRosterPath())).toBe(true)
  })
})

describe('updateRoster', () => {
  test('mutator-in-place is persisted with bumped updatedAt + supervisorPid', async () => {
    const t0 = Date.now()
    await new Promise(r => setTimeout(r, 5))
    const next = await updateRoster(r => {
      r.workers['x'] = {
        pid: 99,
        startedAt: 1,
        attempt: 0,
        cwd: '/x',
      }
    })
    expect(next.workers['x']?.pid).toBe(99)
    expect(next.supervisorPid).toBe(process.pid)
    expect(next.updatedAt).toBeGreaterThan(t0)
  })

  test('return-value mutator path is honored', async () => {
    await updateRoster(() => ({
      proto: 1,
      supervisorPid: 0,
      updatedAt: 0,
      workers: { y: { pid: 1, startedAt: 1, attempt: 0, cwd: '/y' } },
    }))
    const loaded = readRoster()
    expect(loaded.workers['y']?.pid).toBe(1)
  })

  test('concurrent updates serialize last-write-wins', async () => {
    const ops: Promise<unknown>[] = []
    for (let i = 0; i < 10; i++) {
      ops.push(
        updateRoster(r => {
          r.workers[`w${i}`] = {
            pid: i,
            startedAt: i,
            attempt: 0,
            cwd: `/w${i}`,
          }
        }),
      )
    }
    await Promise.all(ops)
    const loaded = readRoster()
    for (let i = 0; i < 10; i++) {
      expect(loaded.workers[`w${i}`]?.pid).toBe(i)
    }
  })
})

describe('recordToRosterEntry', () => {
  test('projects WorkerRecord into RosterEntry', () => {
    const e = recordToRosterEntry({
      short: 'short',
      pid: 42,
      cmd: ['/bin/sh'],
      cwd: '/foo',
      startedAt: 1234,
      status: 'running',
      ptySocket: '/foo/pty.sock',
      cliVersion: 'v26.5.0',
      attempt: 2,
    })
    expect(e.pid).toBe(42)
    expect(e.cwd).toBe('/foo')
    expect(e.ptySock).toBe('/foo/pty.sock')
    expect(e.rendezvousSock).toBe('/foo/pty.sock')
    expect(e.cliVersion).toBe('v26.5.0')
    expect(e.attempt).toBe(2)
  })

  test('default attempt is 0 when missing', () => {
    const e = recordToRosterEntry({
      short: 'short',
      pid: 1,
      cmd: [],
      cwd: '/',
      startedAt: 0,
      status: 'running',
    })
    expect(e.attempt).toBe(0)
  })
})
