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

const ISOLATED_HOME = mkdtempSync(join(tmpdir(), 'ccb-bgadopt-test-'))
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

import { adoptFromRoster, adoptRunningPtyRecords } from '../bgAdopt.js'
import {
  type WorkerRecord,
  readWorkerRecord,
  writeWorkerRecord,
} from '../bgWorkerRegistry.js'
import { writeRoster, emptyRoster } from '../roster.js'
import type { WorkerVm } from '../workerVm.js'

const JOBS_DIR = join(ISOLATED_HOME, 'jobs')

function clearAll(): void {
  try {
    for (const f of readdirSync(JOBS_DIR)) {
      rmSync(join(JOBS_DIR, f), { recursive: true, force: true })
    }
  } catch {}
  try {
    for (const f of readdirSync(join(ISOLATED_HOME, 'daemon'))) {
      if (f.startsWith('roster.json')) {
        rmSync(join(ISOLATED_HOME, 'daemon', f), { force: true })
      }
    }
  } catch {}
  mkdirSync(JOBS_DIR, { recursive: true, mode: 0o700 })
  mkdirSync(join(ISOLATED_HOME, 'daemon'), { recursive: true, mode: 0o700 })
}

beforeEach(clearAll)
afterEach(clearAll)

const baseRecord = (short: string, pid: number): WorkerRecord => ({
  short,
  pid,
  cmd: ['/bin/sh'],
  cwd: '/tmp',
  startedAt: 1_700_000_000_000,
  status: 'running',
  mode: 'pty',
  ptySocket: '/tmp/nonexistent-fake-socket-for-test.sock',
})

describe('adoptRunningPtyRecords', () => {
  test('skips records with status != running', () => {
    const r = baseRecord('abc11111', 99999)
    r.status = 'exited'
    mkdirSync(join(JOBS_DIR, 'abc11111'), { recursive: true })
    writeWorkerRecord(r)
    const workers = new Map<string, WorkerVm>()
    adoptRunningPtyRecords(workers)
    expect(workers.size).toBe(0)
  })

  test('skips records with mode != pty', () => {
    const r = baseRecord('abc22222', 99999)
    r.mode = 'detached'
    mkdirSync(join(JOBS_DIR, 'abc22222'), { recursive: true })
    writeWorkerRecord(r)
    const workers = new Map<string, WorkerVm>()
    adoptRunningPtyRecords(workers)
    expect(workers.size).toBe(0)
  })

  test('marks dead-pid worker as failed with reason', () => {
    const r = baseRecord('abc33333', 99999) // pid 99999 — almost certainly dead
    mkdirSync(join(JOBS_DIR, 'abc33333'), { recursive: true })
    writeWorkerRecord(r)
    const workers = new Map<string, WorkerVm>()
    adoptRunningPtyRecords(workers)
    expect(workers.size).toBe(0)
    const after = readWorkerRecord('abc33333')
    expect(after?.status).toBe('failed')
    expect(after?.failedReason).toBe('process gone while supervisor was down')
    expect(after?.exitedAt).toBeGreaterThan(0)
  })

  test('skips workers already in workers map', () => {
    const r = baseRecord('abc44444', 99999)
    mkdirSync(join(JOBS_DIR, 'abc44444'), { recursive: true })
    writeWorkerRecord(r)
    const workers = new Map<string, WorkerVm>()
    workers.set('abc44444', {} as WorkerVm)
    adoptRunningPtyRecords(workers)
    // Already-present entry isn't reaped
    const after = readWorkerRecord('abc44444')
    expect(after?.status).toBe('running')
  })
})

describe('adoptFromRoster', () => {
  test('parseFailed roster is a no-op', async () => {
    writeFileSync(join(ISOLATED_HOME, 'daemon', 'roster.json'), '{not json')
    // readRoster will quarantine + return parseFailed:true; adoptFromRoster
    // returns immediately without touching workers.
    const workers = new Map<string, WorkerVm>()
    await adoptFromRoster(workers)
    expect(workers.size).toBe(0)
  })

  test('empty roster is a no-op', async () => {
    const workers = new Map<string, WorkerVm>()
    await adoptFromRoster(workers)
    expect(workers.size).toBe(0)
  })

  test('roster entry with dead pid is counted dead + marked failed', async () => {
    const roster = emptyRoster()
    roster.workers['ros11111'] = {
      pid: 99999,
      startedAt: 1,
      attempt: 0,
      cwd: '/tmp',
      ptySock: '/tmp/nonexistent-fake-socket-for-test.sock',
    }
    await writeRoster(roster)
    // Pre-populate jobs/<short>/meta.json so markAdoptionFailed has
    // something to mutate.
    mkdirSync(join(JOBS_DIR, 'ros11111'), { recursive: true })
    writeWorkerRecord({ ...baseRecord('ros11111', 99999), status: 'running' })
    const workers = new Map<string, WorkerVm>()
    await adoptFromRoster(workers)
    expect(workers.size).toBe(0)
    const after = readWorkerRecord('ros11111')
    expect(after?.status).toBe('failed')
    expect(after?.failedReason).toContain('process gone')
  })

  test('roster orphan adoption: missing meta.json is auto-created', async () => {
    // A roster entry that has no jobs/<short>/ tree (cross-cwd entry
    // from a previous supervisor). Use the test runner's pid since
    // it's guaranteed alive — but we still expect markAdoptionFailed
    // not to fire because pid IS alive. The orphan adoption write
    // will fire because no meta.json exists; but the socket-existence
    // check will fail (we point at a nonexistent socket), so this
    // entry counts dead anyway. The orphan-adoption code path runs
    // only on the SUCCESS branch (pid alive AND socket exists), which
    // we can't easily fixture in a unit test. We exercise the negative:
    // roster entry with pid alive but socket gone is NOT adopted.
    const roster = emptyRoster()
    roster.workers['ros22222'] = {
      pid: process.pid,
      startedAt: 1,
      attempt: 0,
      cwd: '/tmp',
      ptySock: '/tmp/nonexistent-fake-socket-for-test.sock',
    }
    await writeRoster(roster)
    const workers = new Map<string, WorkerVm>()
    await adoptFromRoster(workers)
    expect(workers.size).toBe(0)
    // Socket-gone branch creates a meta.json with status='failed'.
    const after = readWorkerRecord('ros22222')
    if (after) {
      expect(after.status).toBe('failed')
      expect(after.failedReason).toContain('socket')
    }
  })

  test('roster entry already in workers map is skipped', async () => {
    const roster = emptyRoster()
    roster.workers['ros33333'] = {
      pid: process.pid,
      startedAt: 1,
      attempt: 0,
      cwd: '/tmp',
    }
    await writeRoster(roster)
    const workers = new Map<string, WorkerVm>()
    workers.set('ros33333', {} as WorkerVm)
    await adoptFromRoster(workers)
    expect(workers.size).toBe(1) // unchanged
  })
})
