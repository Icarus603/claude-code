/**
 * smoke:headless — verify the `-p` (headless / SDK) entry path boots
 * without crashing and reports correct version. Doesn't actually call
 * the API (no stub provider yet); that's the next layer of smoke.
 *
 * Why this matters: -p mode goes through ask → AgentCore.run → AgentLoop,
 * which is a different path than REPL (REPL goes through query.ts).
 * We just fixed HookDepImpl.onStop on this path (commit 8858c83d).
 * If anything else in this path is silently broken, even --version will
 * touch enough of the bootstrap chain to surface it.
 *
 * Run: bun test tests/smoke/headless-smoke.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { spawn } from 'child_process'
import { join } from 'path'

const REPO_ROOT = join(import.meta.dirname, '..', '..')

interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

async function runCli(
  args: string[],
  timeoutMs = 30_000,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'bun',
      ['run', join(REPO_ROOT, 'scripts', 'dev.ts'), ...args],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = '',
      stderr = ''
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

describe('smoke:headless boot', () => {
  test('--version prints something and exits 0', async () => {
    const r = await runCli(['--version'], 30_000)
    expect(r.exitCode).toBe(0)
    expect(r.stdout.length).toBeGreaterThan(0)
    // Should look like a semver-ish string
    expect(r.stdout).toMatch(/\d+\.\d+\.\d+/)
  }, 35_000)

  test('--help exits 0 and prints usage', async () => {
    const r = await runCli(['--help'], 30_000)
    expect(r.exitCode).toBe(0)
    // Help should mention common subcommands
    expect(r.stdout.toLowerCase()).toContain('claude')
  }, 35_000)

  test('startup sequence has no Loading errors in stderr', async () => {
    const r = await runCli(['--version'], 30_000)
    // We accept WARN lines but not ERROR-level failures during the boot
    // path the version fast-path triggers (which is minimal — but enough
    // to surface contract / binding install failures).
    const errorLines = r.stderr
      .split('\n')
      .filter(l => /\[ERROR\]|Uncaught|TypeError|ReferenceError/.test(l))
      .filter(l => !l.includes('plutil') && !l.includes('settings.json'))
    expect(errorLines).toEqual([])
  }, 35_000)
})
