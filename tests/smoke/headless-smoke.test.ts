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
import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const REPO_ROOT = join(import.meta.dirname, '..', '..')

interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

// Some test files that load into the same bun test worker (e.g. live-fire,
// resume, swarm) import @claude-code/cli which triggers a module-level chain
// ending in run-streaming.ts. That chain has a side effect that breaks
// child_process.spawnSync / spawn pipe capture (stdout returns empty buffer
// even though the child exited 0). Workaround: redirect stdout/stderr to
// temp files and read them back, bypassing the broken pipe mechanism.
async function runCli(
  args: string[],
  timeoutMs = 30_000,
): Promise<SpawnResult> {
  const dir = mkdtempSync(join(tmpdir(), 'ccb-smoke-'))
  const outFile = join(dir, 'stdout.txt')
  const errFile = join(dir, 'stderr.txt')
  try {
    const result = spawnSync(
      'bash',
      [
        '-c',
        `bun run ${JSON.stringify(join(REPO_ROOT, 'scripts', 'dev.ts'))} ${args.map(a => JSON.stringify(a)).join(' ')} >"${outFile}" 2>"${errFile}"`,
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: timeoutMs,
      },
    )
    const stdout = (() => { try { return readFileSync(outFile, 'utf8') } catch { return '' } })()
    const stderr = (() => { try { return readFileSync(errFile, 'utf8') } catch { return '' } })()
    return { stdout, stderr, exitCode: result.status }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
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
