/**
 * Relaunch the current ccb process with optionally-overridden env / args.
 *
 * Used by `/tui` and similar commands that change a setting which only takes
 * effect at process boot (alt-screen mode is rmcup/smcup-driven and can't be
 * toggled mid-session without artefacts).
 *
 * Design ported from upstream v2.1.123. Key points:
 *   - spawnSync with `stdio: 'inherit'` keeps the same TTY — the user sees
 *     ccb "redraw itself" rather than a fresh shell prompt.
 *   - Existing SIGINT/SIGTERM/SIGHUP handlers are removed before spawning so
 *     they don't intercept signals meant for the child.
 *   - Parent waits for child to exit, then exits with the same status — this
 *     keeps grandparent shells happy with the exit code.
 *   - `--resume <sessionId>` is added by default so the new process picks up
 *     the conversation. Pass `freshIfNoTranscript: true` to skip resume when
 *     no transcript exists yet (early-session relaunches).
 */

import { spawnSync } from 'child_process'
import { stat } from 'fs/promises'
import { homedir } from 'os'
import { join, sep } from 'path'
import { instances } from '@anthropic/ink'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { cleanupTerminalModes } from '@claude-code/app-host/bootstrap/gracefulShutdown.js'
import { getSessionId } from '@claude-code/app-host/bootstrap/state.js'
import { flushTelemetry } from '@claude-code/local-observability/telemetry'
import { shutdownLocalObservability } from '@claude-code/local-observability'
import { getTranscriptPath } from '@claude-code/storage/sessionStorage.js'

type Launcher = {
  cmd: string
  prefixArgs: string[]
}

/**
 * True when running from a Bun-compiled standalone binary (release build).
 * In dev mode (`bun dist/cli.js`) this returns false — `Bun.embeddedFiles`
 * only exists when bun build --compile baked the JS into the executable.
 */
export function isBunStandalone(): boolean {
  return (
    typeof Bun !== 'undefined' &&
    Array.isArray(Bun.embeddedFiles) &&
    Bun.embeddedFiles.length > 0
  )
}

/**
 * True when this binary was installed by ccb's auto-updater into
 * `~/.local/share/ccb/versions/<vX.Y.Z>/`. The corresponding stable symlink
 * is `~/.local/bin/ccb`, which always points at the latest installed version.
 */
export function isAutoUpdateBinary(): boolean {
  if (!isBunStandalone()) return false
  const versionsDir =
    join(homedir(), '.local', 'share', 'ccb', 'versions') + sep
  return process.execPath.startsWith(versionsDir)
}

/**
 * Resolve how to relaunch ccb. Three cases:
 *
 *   1. Auto-updated standalone — relaunch via the `~/.local/bin/ccb` symlink
 *      so a future auto-update mid-session is picked up after relaunch.
 *      Skip with `pinToCurrentBinary: true` when you specifically want the
 *      same exact binary (rare).
 *   2. Standalone elsewhere (manually placed binary) — re-exec the same path.
 *   3. Dev mode (`bun cli.js`) — re-exec bun with the same script path.
 */
export function getDefaultLauncher(
  opts: { pinToCurrentBinary?: boolean } = {},
): Launcher {
  if (!opts.pinToCurrentBinary && isAutoUpdateBinary()) {
    return {
      cmd: join(homedir(), '.local', 'bin', 'ccb'),
      prefixArgs: [],
    }
  }
  if (isBunStandalone()) {
    return { cmd: process.execPath, prefixArgs: [] }
  }
  const argv1 = process.argv[1]
  if (!argv1) {
    return { cmd: process.execPath, prefixArgs: [] }
  }
  return { cmd: process.execPath, prefixArgs: [argv1] }
}

type RelaunchOptions = {
  /**
   * Override the default arg list. Default behaviour: `--resume <sessionId>`,
   * or `[]` when `freshIfNoTranscript` is true and no transcript exists.
   */
  args?: string[]
  /** Env vars to merge on top of the inherited environment. */
  env?: Record<string, string>
  /** Env keys to delete from the inherited environment before spawning. */
  dropEnv?: string[]
  /** Skip --resume when there's no transcript yet (e.g. boot-time relaunches). */
  freshIfNoTranscript?: boolean
  /** Hook to run just before spawn (e.g. clear screen, save state). */
  preSpawn?: () => void
  /** Override the launcher (testing / pinning). */
  launcher?: Launcher
}

const RELAUNCH_FLUSH_TIMEOUT_MS = 30_000
const RELAUNCH_CLEANUP_TIMEOUT_MS = 2_000

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), timeoutMs)),
  ])
}

/**
 * Replace the current ccb process with a fresh one. Never returns —
 * either spawns the child + waits for it + exits, or fails fatally and exits.
 */
export async function relaunchCli(options: RelaunchOptions = {}): Promise<void> {
  const { cmd, prefixArgs } = options.launcher ?? getDefaultLauncher()

  let args: string[]
  if (options.args) {
    args = options.args
  } else if (options.freshIfNoTranscript) {
    const transcriptPath = getTranscriptPath()
    const hasTranscript = transcriptPath
      ? await stat(transcriptPath)
          .then(s => s.size > 0)
          .catch(() => false)
      : false
    args = hasTranscript ? ['--resume', getSessionId()] : []
  } else {
    args = ['--resume', getSessionId()]
  }

  await Promise.all([
    withTimeout(flushTelemetry(), RELAUNCH_FLUSH_TIMEOUT_MS).catch(() => {}),
    withTimeout(shutdownLocalObservability(), RELAUNCH_CLEANUP_TIMEOUT_MS).catch(
      () => {},
    ),
  ])

  // Tear down the current Ink instance + exit alt-screen + restore terminal
  // modes BEFORE spawning the child. Without this the parent's last frame
  // (and any post-unmount EXIT_ALT_SCREEN sequences) bleed onto the main
  // buffer just before the child takes over, leaving visible artefacts
  // around the new process's banner.
  //
  // cleanupTerminalModes only tears down Ink when isAltScreenActive=true
  // (the gracefulShutdown path is built around that branch). In default
  // mode Ink keeps scheduling renders to the main buffer between cleanup
  // and process.exit, so unmount it explicitly here for the symmetric path.
  const inkInst = instances.get(process.stdout)
  if (inkInst && !inkInst.isAltScreenActive) {
    try {
      inkInst.unmount()
    } catch {
      // unmount races (e.g., already torn down) — non-fatal during relaunch.
    }
  }
  cleanupTerminalModes()

  options.preSpawn?.()

  const env: Record<string, string | undefined> = { ...process.env }
  delete env.CLAUDE_CODE_TUI_JUST_SWITCHED
  if (options.env) {
    for (const [k, v] of Object.entries(options.env)) env[k] = v
  }
  for (const k of options.dropEnv ?? []) delete env[k]

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.removeAllListeners(sig)
    process.on(sig, () => {})
  }

  const result = spawnSync(cmd, [...prefixArgs, ...args], {
    stdio: 'inherit',
    env: env as NodeJS.ProcessEnv,
    cwd: getCwd(),
  })

  process.removeAllListeners('beforeExit')
  process.removeAllListeners('exit')

  if (result.error) {
    process.stderr.write(
      `Failed to relaunch ccb: ${result.error.message}\n`,
    )
    process.exit(1)
  }
  if (result.signal) {
    process.removeAllListeners(result.signal)
    process.kill(process.pid, result.signal)
    process.exit(128)
  }
  process.exit(result.status ?? 0)
}
