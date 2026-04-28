/**
 * Helper for smoke tests: spawn the dev CLI as a subprocess, feed stdin,
 * collect stdout/stderr, return when it exits.
 *
 * Smoke tests differ from unit/integration tests: they exercise the WHOLE
 * binary, including bootstrap, host bindings, hook dispatch, and provider
 * stubs. The point is catching silent failures that pass every static
 * check but break under real wiring (e.g. ralph-loop hook bug).
 *
 * Tests don't hit the real Anthropic API. We set CLAUDE_CODE_USE_OPENAI
 * pointing at a local stub server, OR set up a stub provider via env vars
 * (per-test setup).
 */
import { spawn } from 'child_process'
import { join } from 'path'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')

export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
}

export interface SpawnOptions {
  args?: string[]
  stdin?: string
  env?: Record<string, string>
  /** Subprocess kill timeout in ms (default 30s). */
  timeoutMs?: number
  /** Working directory for the subprocess (default: a fresh tmp dir). */
  cwd?: string
}

/**
 * Run `bun run dev <args>` and return stdout/stderr/exitCode.
 * Caller is responsible for setting env so the subprocess uses a stub
 * provider (or the test will hit Anthropic for real and likely 401).
 */
export async function spawnCli(opts: SpawnOptions = {}): Promise<SpawnResult> {
  const args = opts.args ?? []
  const timeoutMs = opts.timeoutMs ?? 30_000
  const env = {
    ...process.env,
    // Force a deterministic CI-like environment.
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ...opts.env,
  } as NodeJS.ProcessEnv

  const start = Date.now()
  // Use scripts/dev.ts so MACRO defines + default features are injected
  // exactly like the user's real `bun run dev` invocation. Skipping that
  // would silently disable features the smoke test should be exercising.
  const proc = spawn(
    'bun',
    ['run', join(REPO_ROOT, 'scripts', 'dev.ts'), ...args],
    {
      cwd: opts.cwd ?? REPO_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
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

  if (opts.stdin !== undefined) {
    proc.stdin?.write(opts.stdin)
    proc.stdin?.end()
  } else {
    proc.stdin?.end()
  }

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`spawnCli timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    proc.once('exit', code => {
      clearTimeout(timer)
      resolve(code)
    })
    proc.once('error', err => {
      clearTimeout(timer)
      reject(err)
    })
  }).catch(err => {
    if (err instanceof Error && err.message.includes('timed out')) {
      return null
    }
    throw err
  })

  return {
    stdout,
    stderr,
    exitCode,
    durationMs: Date.now() - start,
  }
}
