import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { drainSpool, ingestEnvelope, writeSpoolEnvelope } from '../dispatchSpool.js'

const SPOOL = join(homedir(), '.claude', 'daemon', 'dispatch')
const REJECTED = join(SPOOL, 'rejected')

function clearSpool(): void {
  try {
    rmSync(SPOOL, { recursive: true, force: true })
  } catch {}
  mkdirSync(SPOOL, { recursive: true, mode: 0o700 })
}

beforeEach(clearSpool)
afterEach(clearSpool)

describe('writeSpoolEnvelope', () => {
  test('atomic write + valid filename', () => {
    const path = writeSpoolEnvelope({
      createdAt: Date.now(),
      op: 'dispatch',
      d: { short: 'abc', cwd: '/tmp' },
    })
    expect(existsSync(path)).toBe(true)
    expect(path.endsWith('.json')).toBe(true)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    expect(parsed.op).toBe('dispatch')
    expect(parsed.d.short).toBe('abc')
  })
})

describe('ingestEnvelope', () => {
  test('valid envelope is delivered + file consumed', async () => {
    const path = writeSpoolEnvelope({ createdAt: Date.now(), op: 'spawn', d: { short: 'x' } })
    let delivered: unknown
    const reason = await ingestEnvelope(path, env => { delivered = env })
    expect(reason).toBe(null)
    expect(existsSync(path)).toBe(false)
    expect((delivered as { op: string }).op).toBe('spawn')
  })

  test('stale envelope (>24h) is rejected', async () => {
    const path = writeSpoolEnvelope({ createdAt: Date.now() - 86_400_001, op: 'spawn', d: {} })
    const reason = await ingestEnvelope(path, () => {})
    expect(reason).toBe('stale')
    expect(existsSync(path)).toBe(false)
  })

  test('bad json is rejected', async () => {
    const path = join(SPOOL, 'bad.json')
    writeFileSync(path, '{not json')
    const reason = await ingestEnvelope(path, () => {})
    expect(reason).toBe('bad-json')
  })

  test('schema-invalid (missing op) is rejected', async () => {
    const path = join(SPOOL, 'noop.json')
    writeFileSync(path, JSON.stringify({ createdAt: Date.now(), d: {} }))
    const reason = await ingestEnvelope(path, () => {})
    expect(reason).toBe('schema')
  })

  test('oversized payload (>256 KiB) is rejected', async () => {
    const path = join(SPOOL, 'big.json')
    const big = 'x'.repeat(300_000)
    writeFileSync(path, JSON.stringify({ createdAt: Date.now(), op: 'spawn', d: { big } }))
    const reason = await ingestEnvelope(path, () => {})
    expect(reason).toBe('oversized')
  })

  test('missing file returns null (race-safe)', async () => {
    const reason = await ingestEnvelope(join(SPOOL, 'gone.json'), () => {})
    expect(reason).toBe(null)
  })

  test('rejected files moved to rejected/ subdir', async () => {
    const path = join(SPOOL, 'badjson.json')
    writeFileSync(path, '{not json')
    await ingestEnvelope(path, () => {})
    expect(existsSync(REJECTED)).toBe(true)
  })

  test('deliver-throws marks deliver-failed + rejects', async () => {
    const path = writeSpoolEnvelope({ createdAt: Date.now(), op: 'spawn', d: {} })
    const reason = await ingestEnvelope(path, () => { throw new Error('boom') })
    expect(reason).toBe('deliver-failed')
  })
})

describe('drainSpool', () => {
  test('processes all pending envelopes on boot', async () => {
    writeSpoolEnvelope({ createdAt: Date.now(), op: 'spawn', d: { id: 1 } })
    writeSpoolEnvelope({ createdAt: Date.now(), op: 'spawn', d: { id: 2 } })
    writeSpoolEnvelope({ createdAt: Date.now(), op: 'spawn', d: { id: 3 } })
    const ids: unknown[] = []
    await drainSpool(env => ids.push((env.d as { id: number }).id))
    expect(ids.sort()).toEqual([1, 2, 3])
  })

  test('skips .tmp files', async () => {
    writeFileSync(join(SPOOL, '12345.tmp'), '{}')
    writeSpoolEnvelope({ createdAt: Date.now(), op: 'spawn', d: {} })
    let count = 0
    await drainSpool(() => count++)
    expect(count).toBe(1)
  })

  test('empty dir is a no-op', async () => {
    let count = 0
    await drainSpool(() => count++)
    expect(count).toBe(0)
  })

  test('handles missing dir', async () => {
    rmSync(SPOOL, { recursive: true, force: true })
    let count = 0
    await drainSpool(() => count++)
    expect(count).toBe(0)
  })
})
