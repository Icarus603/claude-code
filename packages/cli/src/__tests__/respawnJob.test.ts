import { describe, expect, mock, test } from 'bun:test'

import { respawnSingle, type RespawnJobMeta } from '../bg/respawnJob.js'

const baseMeta: RespawnJobMeta = {
  short: 'r0000001',
  pid: 99999,
  cmd: ['/bin/sh', '/path/cli.js', '-p', 'do thing'],
  cwd: '/tmp',
  status: 'running',
  mode: 'detached',
}

const noopHelpers = {
  getJobDir: (s: string) => `/tmp/jobs/${s}`,
  generateShortId: () => 'newshort',
  spawnBgJob: async () => 'newshort',
  writeJobMeta: () => {},
}

describe('respawnSingle (detached path)', () => {
  test('returns false when extractRespawnArgs cannot reconstruct', async () => {
    // cmd missing -p marker → extractRespawnArgs returns null
    const meta: RespawnJobMeta = {
      ...baseMeta,
      cmd: ['/bin/sh'],
    }
    // Capture stderr writes so the test runner doesn't pollute output
    const originalWrite = process.stderr.write.bind(process.stderr)
    let captured = ''
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    }) as typeof process.stderr.write
    try {
      const ok = await respawnSingle(meta, noopHelpers)
      expect(ok).toBe(false)
      expect(captured).toContain('cannot reconstruct directive')
    } finally {
      process.stderr.write = originalWrite
    }
  })

  test('happy path delegates to spawnBgJob and prints (was X, now Y)', async () => {
    let spawnCalled = false
    let spawnedFlags: readonly string[] | undefined
    let spawnedDirective: string | undefined
    const helpers = {
      ...noopHelpers,
      spawnBgJob: async (opts: {
        flags: readonly string[]
        directive: string
        cwd: string
      }): Promise<string> => {
        spawnCalled = true
        spawnedFlags = opts.flags
        spawnedDirective = opts.directive
        return 'newshort'
      },
    }
    const originalWrite = process.stdout.write.bind(process.stdout)
    let captured = ''
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    }) as typeof process.stdout.write
    try {
      const ok = await respawnSingle(baseMeta, helpers)
      expect(ok).toBe(true)
      expect(spawnCalled).toBe(true)
      expect(spawnedDirective).toBe('do thing')
      // extractRespawnArgs takes everything between argv[i] and the
      // -p marker as flags. With cmd starting [/bin/sh, /path/cli.js,
      // -p, …], i=1 so /path/cli.js becomes the lone flag.
      expect(spawnedFlags).toEqual(['/path/cli.js'])
      expect(captured).toContain('was r0000001')
      expect(captured).toContain('newshort')
    } finally {
      process.stdout.write = originalWrite
    }
  })

  test('catches spawn error + returns false', async () => {
    const helpers = {
      ...noopHelpers,
      spawnBgJob: async () => {
        throw new Error('spawn failed: ENOENT')
      },
    }
    const originalWrite = process.stderr.write.bind(process.stderr)
    let captured = ''
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    }) as typeof process.stderr.write
    try {
      const ok = await respawnSingle(baseMeta, helpers)
      expect(ok).toBe(false)
      expect(captured).toContain('r0000001: spawn failed: ENOENT')
    } finally {
      process.stderr.write = originalWrite
    }
  })

  test('does not call SIGTERM when status is not running', async () => {
    let killCalled = false
    const originalKill = process.kill
    ;(process as { kill: typeof process.kill }).kill = ((
      pid: number,
      sig?: NodeJS.Signals | number,
    ) => {
      // signal-0 is the liveness probe (isProcessRunning) — allow it.
      if (sig === 0) return originalKill(pid, sig)
      killCalled = true
      return true
    }) as typeof process.kill
    try {
      await respawnSingle({ ...baseMeta, status: 'exited' }, noopHelpers)
      expect(killCalled).toBe(false)
    } finally {
      ;(process as { kill: typeof process.kill }).kill = originalKill
    }
  })
})

describe('respawnSingle (pty path with daemon)', () => {
  test('non-pty meta does not attempt daemonRespawn', async () => {
    // detached mode never reaches the daemon import path. Verifies
    // the early-return mode-gate at line 50.
    let daemonImported = false
    mock.module('../bg/daemonAdapter.js', () => {
      daemonImported = true
      return {
        isDaemonAlive: async () => true,
        daemonRespawn: async () => ({ ok: true }),
      }
    })
    const helpers = {
      ...noopHelpers,
      spawnBgJob: async () => 'newshort',
    }
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (() => true) as typeof process.stdout.write
    try {
      await respawnSingle(baseMeta, helpers)
      // detached path skipped daemon entirely
      expect(daemonImported).toBe(false)
    } finally {
      process.stdout.write = originalWrite
    }
  })
})
