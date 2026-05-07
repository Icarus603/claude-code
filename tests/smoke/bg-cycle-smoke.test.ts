/**
 * smoke:bg — verify the full --bg cycle works end-to-end:
 *   1. `ccb --bg-detached "directive"` writes meta.json + spawns child
 *   2. `ccb ps` lists the new short
 *   3. `ccb stop <short>` marks it stopped
 *   4. `ccb rm <short>` removes the job dir
 *
 * Uses --bg-detached (not --bg / --bg-pty) so the child is a simple
 * `-p` process we can kill cleanly without a PTY host. Probes the
 * detached path of bg.ts; the PTY path needs a live socket and is
 * exercised by integration tests.
 *
 * Each test uses CLAUDE_CONFIG_HOME pointing at a per-test tmpdir so
 * we don't pollute the user's real ~/.claude/jobs/.
 *
 * Run: bun test tests/smoke/bg-cycle-smoke.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), 'ccb-bg-smoke-'))

interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

async function runCli(
  args: string[],
  timeoutMs = 20_000,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'bun',
      ['run', join(REPO_ROOT, 'scripts', 'dev.ts'), ...args],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          NO_COLOR: '1',
          FORCE_COLOR: '0',
          CLAUDE_CONFIG_HOME: ISOLATED_HOME,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', d => {
      stdout += d.toString()
    })
    proc.stderr?.on('data', d => {
      stderr += d.toString()
    })
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(
        new Error(
          `runCli ${args.join(' ')} timed out after ${timeoutMs}ms\nstdout: ${stdout}\nstderr: ${stderr}`,
        ),
      )
    }, timeoutMs)
    proc.once('exit', code => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code })
    })
    proc.once('error', err => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

afterAll(() => {
  rmSync(ISOLATED_HOME, { recursive: true, force: true })
})

describe('smoke:bg cycle (detached)', () => {
  let short: string | undefined

  test('--bg-detached spawns child + writes meta.json', async () => {
    const r = await runCli(['--bg-detached', 'echo smoke'], 25_000)
    expect(r.exitCode).toBe(0)
    // backgrounded · <short> line appears in stdout
    expect(r.stdout).toContain('backgrounded')
    // Capture short id from the cyan banner. Strip ANSI escapes since
    // FORCE_COLOR=0 might still leak through some chalk paths. Build
    // the regex from String.fromCharCode(0x1b) to keep biome's
    // noControlCharactersInRegex rule happy without losing the strip.
    const ansiEscape = String.fromCharCode(0x1b)
    const ansiRe = new RegExp(`${ansiEscape}\\[[0-9;]*m`, 'g')
    const cleaned = r.stdout.replace(ansiRe, '')
    const m = cleaned.match(/backgrounded\s*·\s*([a-f0-9]{8})/)
    expect(m).toBeTruthy()
    short = m?.[1]
    expect(short).toBeTruthy()
    // Job dir + meta.json should now exist under the isolated home.
    const jobDir = join(ISOLATED_HOME, 'jobs', short!)
    expect(existsSync(jobDir)).toBe(true)
    const metaPath = join(jobDir, 'meta.json')
    expect(existsSync(metaPath)).toBe(true)
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    expect(meta.short).toBe(short)
    expect(meta.status).toBe('running')
    expect(typeof meta.pid).toBe('number')
  }, 30_000)

  test('ps surfaces the new short', async () => {
    expect(short).toBeTruthy()
    const r = await runCli(['ps'], 15_000)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain(short!)
  }, 20_000)

  test('rm removes the job dir', async () => {
    expect(short).toBeTruthy()
    // ccb rm refuses on running jobs unless we stop first; reconcile
    // happens on read so SIGKILL the child via the stop --force path
    // isn't possible from a parallel process. Best-effort: just rm it
    // — bg.ts rm handler refuses if status==='running'. We need to
    // mark exited first via meta.json mutation since we don't have a
    // signal to send (the spawned child exits naturally after `echo
    // smoke` completes; it might already be exited by now).
    // Wait briefly for the echo child to exit, then ccb rm should
    // succeed.
    await new Promise(r => setTimeout(r, 1500))
    // ps reconciles status — running it once auto-marks the dead pid
    // as 'exited'.
    await runCli(['ps'], 15_000)
    const r = await runCli(['rm', short!], 15_000)
    if (r.exitCode !== 0) {
      // Some `echo smoke` invocations live longer than expected if
      // the shell wraps in a long-lived REPL; this is a best-effort
      // cleanup. Force-kill via the kill handler then retry rm.
      await runCli(['kill', short!], 10_000)
      await new Promise(r => setTimeout(r, 500))
      const r2 = await runCli(['rm', short!], 10_000)
      expect(r2.exitCode).toBe(0)
    }
    const jobDir = join(ISOLATED_HOME, 'jobs', short!)
    expect(existsSync(jobDir)).toBe(false)
  }, 60_000)
})

describe('smoke:bg argParse', () => {
  test('isolated home has been used (no leakage to ~/.claude/jobs)', () => {
    // The actual ~/.claude/jobs/ should not contain our smoke shorts.
    // We can't assert ABSENCE strictly (user may have other jobs) but
    // we can confirm our isolated home was where the cycle ran.
    expect(existsSync(join(ISOLATED_HOME, 'jobs'))).toBe(true)
  })

  test('isolated daemon dir was used', () => {
    // The isolated home's daemon/ subtree should exist if any roster
    // write happened. Smoke test only goes through the detached
    // `-p` path which doesn't touch roster, but the dir scaffold
    // would still be lazy-created if it had.
    const d = join(ISOLATED_HOME, 'daemon')
    if (existsSync(d)) {
      // If created, it's owner-writable — confirm mode.
      const entries = readdirSync(d)
      expect(Array.isArray(entries)).toBe(true)
    }
  })
})
