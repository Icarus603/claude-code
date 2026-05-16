/**
 * Fleet-store I/O tests — write a state.json, read it back, mutate
 * sort orders + pin set, verify cache invalidation.
 *
 * Uses CLAUDE_CONFIG_HOME to redirect the jobs root into a tmp dir per
 * test so we don't touch the user's real ~/.claude.
 */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  clearAllCaches,
  getJobDir,
  getJobsRoot,
  listJobsFromDisk,
  readJobState,
  readPinSet,
  writeJobState,
  writePinSet,
  writeSortOrder,
  writeStateSortOrder,
} from '../fleetStore.js'
import type { FleetJobState } from '../fleetTypes.js'

let tmpRoot: string

function mockState(overrides: Partial<FleetJobState> = {}): FleetJobState {
  return {
    state: 'working',
    tempo: 'active',
    detail: 'doing the thing',
    output: null,
    children: null,
    linkScanOffset: 0,
    template: 'bg',
    respawnFlags: [],
    intent: 'fix the bug',
    sessionId: 'aaaaaaaa-bbbb',
    daemonShort: 'aaaaaaaa',
    cwd: '/home/me/repo',
    createdAt: '2026-05-16T10:00:00Z',
    updatedAt: '2026-05-16T10:00:00Z',
    firstTerminalAt: null,
    backend: 'daemon',
    ...overrides,
  }
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(join(tmpdir(), 'ccb-fleet-test-'))
  process.env.CLAUDE_CONFIG_HOME = tmpRoot
  clearAllCaches()
})

afterEach(async () => {
  delete process.env.CLAUDE_CONFIG_HOME
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('fleetStore', () => {
  test('getJobsRoot honours CLAUDE_CONFIG_HOME', () => {
    expect(getJobsRoot()).toBe(join(tmpRoot, 'jobs'))
  })

  test('write then read round-trips the state, stripping pinned/sortOrder', async () => {
    const dir = getJobDir('aaaaaaaa')
    await writeJobState(dir, mockState({ pinned: true, sortOrder: 42 }))
    clearAllCaches()
    const got = await readJobState(dir)
    expect(got).not.toBeNull()
    expect(got?.intent).toBe('fix the bug')
    // pinned/sortOrder should NOT be persisted to state.json
    expect(got?.pinned).toBeUndefined()
    expect(got?.sortOrder).toBeUndefined()
  })

  test('readJobState merges sortOrder + stateSortOrder from sibling files', async () => {
    const dir = getJobDir('bbbbbbbb')
    await writeJobState(dir, mockState({ daemonShort: 'bbbbbbbb' }))
    await writeSortOrder(dir, 17)
    await writeStateSortOrder(dir, 99)
    clearAllCaches()
    const got = await readJobState(dir)
    expect(got?.sortOrder).toBe(17)
    expect(got?.stateSortOrder).toBe(99)
  })

  test('readJobState returns null for missing dir', async () => {
    expect(await readJobState(getJobDir('nope'))).toBeNull()
  })

  test('readJobState returns null for malformed JSON', async () => {
    const dir = getJobDir('bad')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'state.json'), 'not-json')
    expect(await readJobState(dir)).toBeNull()
  })

  test('pin set round-trips through pins.json', async () => {
    await writePinSet(new Set(['aaaa', 'bbbb']))
    const got = await readPinSet()
    expect([...got].sort()).toEqual(['aaaa', 'bbbb'])
  })

  test('pin migration falls back to per-job marker files when pins.json missing', async () => {
    const dir1 = getJobDir('cccccccc')
    const dir2 = getJobDir('dddddddd')
    await writeJobState(dir1, mockState({ daemonShort: 'cccccccc' }))
    await writeJobState(dir2, mockState({ daemonShort: 'dddddddd' }))
    // Only one has a pinned marker
    await fs.writeFile(join(dir1, 'pinned'), '')
    const got = await readPinSet()
    expect([...got]).toEqual(['cccccccc'])
  })

  test('listJobsFromDisk enumerates all jobs and merges pinned flag', async () => {
    await writeJobState(getJobDir('11111111'), mockState({ daemonShort: '11111111' }))
    await writeJobState(getJobDir('22222222'), mockState({ daemonShort: '22222222' }))
    await writePinSet(new Set(['11111111']))
    const jobs = await listJobsFromDisk()
    expect(jobs).toHaveLength(2)
    const byId = Object.fromEntries(jobs.map(j => [j.id, j]))
    expect(byId['11111111']!.state.pinned).toBe(true)
    expect(byId['22222222']!.state.pinned).toBeUndefined()
  })

  test('cache hit short-circuits second read', async () => {
    const dir = getJobDir('cache0001')
    await writeJobState(dir, mockState())
    const a = await readJobState(dir)
    const b = await readJobState(dir) // should hit cache
    expect(b).toBe(a) // same object reference
  })

  test('writeJobState invalidates cache so next read re-loads', async () => {
    const dir = getJobDir('cache0002')
    await writeJobState(dir, mockState({ detail: 'first' }))
    const first = await readJobState(dir)
    expect(first?.detail).toBe('first')
    await writeJobState(dir, mockState({ detail: 'second' }))
    const second = await readJobState(dir)
    expect(second?.detail).toBe('second')
  })
})
