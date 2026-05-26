import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Isolate every roster test under a per-run tmpdir, NEVER touch the
// user's real ~/.claude/daemon. Done via CLAUDE_CONFIG_HOME, which is
// the same env var bgWorkerRegistry.getJobsRoot() respects.
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), 'ccb-roster-test-'))
const DAEMON_DIR = join(ISOLATED_HOME, 'daemon')
const ORIGINAL_CONFIG_HOME = process.env.CLAUDE_CONFIG_HOME

beforeAll(() => {
  process.env.CLAUDE_CONFIG_HOME = ISOLATED_HOME
})
afterAll(() => {
  if (ORIGINAL_CONFIG_HOME === undefined) {
    delete process.env.CLAUDE_CONFIG_HOME
  } else {
    process.env.CLAUDE_CONFIG_HOME = ORIGINAL_CONFIG_HOME
  }
  rmSync(ISOLATED_HOME, { recursive: true, force: true })
})

import {
  emptyRoster,
  getRosterPath,
  readRoster,
  recordToRosterEntry,
  updateRoster,
  writeRoster,
} from '../roster.js'

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
  test('missing file → emptyRoster', async () => {
    const r = await readRoster()
    expect(r.workers).toEqual({})
    expect(r.parseFailed).toBeUndefined()
  })

  test('valid roster round-trips through readRoster', async () => {
    const original = emptyRoster()
    original.workers['abc12345'] = {
      pid: 1234,
      startedAt: 1_700_000_000_000,
      attempt: 0,
      cwd: '/tmp',
      ptySock: '/tmp/foo.sock',
    }
    await writeRoster(original)
    const loaded = await readRoster()
    expect(loaded.workers['abc12345']?.pid).toBe(1234)
    expect(loaded.workers['abc12345']?.cwd).toBe('/tmp')
    expect(loaded.parseFailed).toBeUndefined()
  })

  test('corrupt JSON quarantines + returns parseFailed', async () => {
    writeFileSync(getRosterPath(), '{not json')
    const r = await readRoster()
    expect(r.parseFailed).toBe(true)
    expect(existsSync(getRosterPath())).toBe(false)
    const corrupt = readdirSync(DAEMON_DIR).filter(f =>
      f.startsWith('roster.json.corrupt.'),
    )
    expect(corrupt.length).toBeGreaterThan(0)
  })

  test('schema mismatch quarantines + returns parseFailed', async () => {
    writeFileSync(
      getRosterPath(),
      JSON.stringify({ proto: 1, supervisorPid: 'not-a-number', workers: {} }),
    )
    const r = await readRoster()
    expect(r.parseFailed).toBe(true)
    expect(existsSync(getRosterPath())).toBe(false)
  })

  test('silent:true skips quarantine on parse error', async () => {
    writeFileSync(getRosterPath(), '{not json')
    const r = await readRoster({ silent: true })
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
    const loaded = await readRoster()
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
    const loaded = await readRoster()
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
      rendezvousSocket: '/foo/rv.sock',
      cliVersion: 'v26.5.0',
      attempt: 2,
    })
    expect(e.pid).toBe(42)
    expect(e.cwd).toBe('/foo')
    expect(e.ptySock).toBe('/foo/pty.sock')
    // The rv (control) socket is a DISTINCT socket from the PTY data socket
    // and must be projected from r.rendezvousSocket — NOT aliased to
    // r.ptySocket. A roster restart re-points the rv client using this; if
    // it carried the PTY path, the rv handshake would corrupt the PTY stream.
    expect(e.rendezvousSock).toBe('/foo/rv.sock')
    expect(e.cliVersion).toBe('v26.5.0')
    expect(e.attempt).toBe(2)
  })

  test('rv socket survives a roster write→read round-trip (restart recovery)', async () => {
    // The whole point of persisting rendezvousSocket: a supervisor restart
    // must recover the rv address from roster.json so adoptFromRoster can
    // re-point the rv client. Lock that round-trip.
    await updateRoster(r => {
      r.workers['rvjob'] = recordToRosterEntry({
        short: 'rvjob',
        pid: 7,
        cmd: [],
        cwd: '/work',
        startedAt: 100,
        status: 'running',
        mode: 'pty',
        ptySocket: '/work/pty.sock',
        rendezvousSocket: '/work/rv.sock',
      })
    })
    const loaded = await readRoster()
    expect(loaded.workers['rvjob']?.ptySock).toBe('/work/pty.sock')
    expect(loaded.workers['rvjob']?.rendezvousSock).toBe('/work/rv.sock')
  })

  test('rendezvousSock is undefined for a worker with no rv socket (pre-rv-channel)', () => {
    const e = recordToRosterEntry({
      short: 'legacy',
      pid: 9,
      cmd: [],
      cwd: '/old',
      startedAt: 0,
      status: 'running',
      ptySocket: '/old/pty.sock',
      // no rendezvousSocket — worker spawned before the rv channel existed
    })
    // Must be undefined (rv client no-ops), NOT silently the PTY path.
    expect(e.rendezvousSock).toBeUndefined()
    expect(e.ptySock).toBe('/old/pty.sock')
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
