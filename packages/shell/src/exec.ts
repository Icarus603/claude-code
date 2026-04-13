/**
 *
 */
import { constants as fsConstants, readFileSync, unlinkSync } from 'fs'
import { type FileHandle, mkdir, open, realpath } from 'fs/promises'
import { isAbsolute, resolve } from 'path'
import { join as posixJoin } from 'path/posix'
import type { ShellExecContext } from './context.js'
import {
  errorMessage,
  generateTaskId,
  getPlatform,
  isENOENT,
  logForDebugging,
  logEvent,
  posixPathToWindowsPath,
} from './_deps.js'
import { subprocessEnv } from './subprocessEnv.js'
import type { ExecOptions, ShellProvider, ShellType } from './types.js'
import type { TaskOutputPort } from './taskOutputPort.js'
import {
  type ShellCommandWithOutput,
  createAbortedCommand,
  createFailedCommand,
  MAX_TASK_OUTPUT_BYTES,
  wrapSpawn,
} from './shellCommand.js'
import { createProviderResolver } from './shellDiscovery.js'
import { ExecError } from './errors.js'

export type { ExecResult } from './types.js'
export type { ExecOptions } from './types.js'

const DEFAULT_TIMEOUT = 30 * 60 * 1000 // 30 minutes


/**
 */
let _createTaskOutputFn:
  | ((
      taskId: string,
      onProgress: ((...args: unknown[]) => void) | null,
      stdoutToFile: boolean,
    ) => TaskOutputPort)
  | undefined

export function setCreateTaskOutputFn(
  fn: (
    taskId: string,
    onProgress: ((...args: unknown[]) => void) | null,
    stdoutToFile: boolean,
  ) => TaskOutputPort,
): void {
  _createTaskOutputFn = fn
}


let _getSandboxTmpDirNameFn:
  | (() => string)
  | undefined

export function setGetSandboxTmpDirNameFn(fn: () => string): void {
  _getSandboxTmpDirNameFn = fn
}


// Provider resolvers are memoized per-session via createProviderResolver
let _resolveProvider:
  | Record<ShellType, () => Promise<ShellProvider>>
  | undefined

function getProviderResolver(
  ctx: ShellExecContext,
): Record<ShellType, () => Promise<ShellProvider>> {
  if (!_resolveProvider) {
    _resolveProvider = createProviderResolver(ctx)
  }
  return _resolveProvider
}


class StubTaskOutput implements TaskOutputPort {
  readonly taskId: string
  readonly path = ''
  readonly stdoutToFile = false
  readonly outputFileRedundant = false
  readonly outputFileSize = 0

  constructor(taskId: string) {
    this.taskId = taskId
  }

  writeStdout(): void {}
  writeStderr(): void {}
  async getStdout(): Promise<string> {
    return ''
  }
  getStderr(): string {
    return ''
  }
  clear(): void {}
  spillToDisk(): void {}
  async deleteOutputFile(): Promise<void> {}
  async flush(): Promise<void> {}
}

// ─── exec() ───────────────────────────────────────────────────────

/**
 * Execute a shell command using the environment snapshot.
 * Creates a new shell process for each command execution.
 *
 * @param command - The command string to execute
 * @param abortSignal - AbortSignal for cancellation
 * @param shellType - Shell type ('bash' or 'powershell')
 * @param ctx - ShellExecContext providing all runtime dependencies
 * @param options - Execution options
 */
export async function exec(
  command: string,
  abortSignal: AbortSignal,
  shellType: ShellType,
  ctx: ShellExecContext,
  options?: ExecOptions,
): Promise<ShellCommandWithOutput> {
  const {
    timeout,
    onProgress,
    preventCwdChanges,
    shouldUseSandbox,
    shouldAutoBackground,
    onStdout,
  } = options ?? {}
  const commandTimeout = timeout || DEFAULT_TIMEOUT

  const provider = await getProviderResolver(ctx)[shellType]()

  const id = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')

  // Sandbox temp directory - use per-user directory name to prevent multi-user permission conflicts
  const sandboxTmpDir = posixJoin(
    process.env.CLAUDE_CODE_TMPDIR || '/tmp',
    _getSandboxTmpDirNameFn?.() ?? 'claude-code',
  )

  const { commandString: builtCommand, cwdFilePath } =
    await provider.buildExecCommand(command, {
      id,
      sandboxTmpDir: shouldUseSandbox ? sandboxTmpDir : undefined,
      useSandbox: shouldUseSandbox ?? false,
    })

  let commandString = builtCommand

  let cwd = ctx.getCwd()

  // Recover if the current working directory no longer exists on disk.
  try {
    await realpath(cwd)
  } catch {
    const fallback = ctx.getOriginalCwd()
    logForDebugging(
      `Shell CWD "${cwd}" no longer exists, recovering to "${fallback}"`,
    )
    try {
      await realpath(fallback)
      ctx.setCwd(fallback)
      cwd = fallback
    } catch {
      return createFailedCommand(
        `Working directory "${cwd}" no longer exists. Please restart Claude from an existing directory.`,
      )
    }
  }

  // If already aborted, don't spawn the process at all
  if (abortSignal.aborted) {
    return createAbortedCommand()
  }

  const binShell = provider.shellPath

  // Sandboxed PowerShell: wrapWithSandbox hardcodes `<binShell> -c '<cmd>'` —
  // using pwsh there would lose -NoProfile -NonInteractive. Instead:
  //   • powershellProvider.buildExecCommand (useSandbox) pre-wraps as
  //     pwsh -NoProfile -NonInteractive -EncodedCommand <base64>
  //   • pass /bin/sh as the sandbox's inner shell
  //   • outer spawn is also /bin/sh -c
  const isSandboxedPowerShell =
    shouldUseSandbox && shellType === 'powershell'
  const sandboxBinShell = isSandboxedPowerShell ? '/bin/sh' : binShell

  if (shouldUseSandbox) {
    if (ctx.wrapWithSandbox) {
      commandString = await ctx.wrapWithSandbox(
        commandString,
        sandboxBinShell,
        undefined,
        abortSignal,
      )
    }
    // Create sandbox temp directory for sandboxed processes with secure permissions
    try {
      await mkdir(sandboxTmpDir, { mode: 0o700 })
    } catch (error) {
      logForDebugging(
        `Failed to create ${sandboxTmpDir} directory: ${error}`,
      )
    }
  }

  const spawnBinary = isSandboxedPowerShell ? '/bin/sh' : binShell
  const shellArgs = isSandboxedPowerShell
    ? ['-c', commandString]
    : provider.getSpawnArgs(commandString)
  const envOverrides = await provider.getEnvironmentOverrides(command)

  // When onStdout is provided, use pipe mode
  const usePipeMode = !!onStdout
  const taskId = generateTaskId('b')
  const taskOutputDir = ctx.getTaskOutputDir()
  await mkdir(taskOutputDir, { recursive: true })

  // Create TaskOutput via injected factory
  const taskOutput: TaskOutputPort = _createTaskOutputFn
    ? _createTaskOutputFn(taskId, onProgress ?? null, !usePipeMode)
    : new StubTaskOutput(taskId)

  // In file mode, both stdout and stderr go to the same file fd.
  let outputHandle: FileHandle | undefined
  if (!usePipeMode && taskOutput.path) {
    const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
    outputHandle = await open(
      taskOutput.path,
      process.platform === 'win32'
        ? 'w'
        : fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_APPEND |
            O_NOFOLLOW,
    )
  }

  const { spawn } = await import('child_process')

  try {
    const childProcess = spawn(spawnBinary, shellArgs, {
      env: {
        ...subprocessEnv(),
        SHELL: shellType === 'bash' ? binShell : undefined,
        GIT_EDITOR: 'true',
        CLAUDECODE: '1',
        ...envOverrides,
        ...(process.env.USER_TYPE === 'ant'
          ? {
              CLAUDE_CODE_SESSION_ID: ctx.getSessionId(),
            }
          : {}),
      },
      cwd,
      stdio: usePipeMode
        ? ['pipe', 'pipe', 'pipe']
        : ['pipe', outputHandle?.fd, outputHandle?.fd],
      // Don't pass the signal - we'll handle termination ourselves with tree-kill
      detached: provider.detached,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    })

    const shellCommand = wrapSpawn(
      childProcess,
      abortSignal,
      commandTimeout,
      taskOutput,
      shouldAutoBackground,
      MAX_TASK_OUTPUT_BYTES,
    )

    // Close our copy of the fd
    if (outputHandle !== undefined) {
      try {
        await outputHandle.close()
      } catch {
        // fd may already be closed by the child; safe to ignore
      }
    }

    // In pipe mode, attach the caller's stdout callback
    if (childProcess.stdout && onStdout) {
      childProcess.stdout.on('data', (chunk: string | Buffer) => {
        onStdout(typeof chunk === 'string' ? chunk : chunk.toString())
      })
    }

    // CWD tracking post-execution
    const nativeCwdFilePath =
      getPlatform() === 'windows'
        ? posixPathToWindowsPath(cwdFilePath)
        : cwdFilePath

    void shellCommand.result.then(async result => {
      // Sandbox cleanup
      if (shouldUseSandbox) {
        ctx.cleanupAfterSandbox?.()
      }
      // Only foreground tasks update the cwd
      if (result && !preventCwdChanges && !result.backgroundTaskId) {
        try {
          let newCwd = readFileSync(nativeCwdFilePath, {
            encoding: 'utf8',
          }).trim()
          if (getPlatform() === 'windows') {
            newCwd = posixPathToWindowsPath(newCwd)
          }
          // NFC normalize for Unicode path comparison
          if (newCwd.normalize('NFC') !== cwd) {
            setCwd(ctx, newCwd, cwd)
            ctx.invalidateSessionEnvCache?.()
            void ctx.onCwdChanged?.(cwd, newCwd)
          }
        } catch {
          logEvent('tengu_shell_set_cwd', { success: false })
        }
      }
      // Clean up the temp file used for cwd tracking
      try {
        unlinkSync(nativeCwdFilePath)
      } catch {
        // File may not exist if command failed before pwd -P ran
      }
    })

    return shellCommand
  } catch (error) {
    // Close the fd if spawn failed (child never got its dup)
    if (outputHandle !== undefined) {
      try {
        await outputHandle.close()
      } catch {
        // May already be closed
      }
    }
    taskOutput.clear()

    logForDebugging(`Shell exec error: ${errorMessage(error)}`)

    return createAbortedCommand(undefined, {
      code: 126, // Standard Unix code for execution errors
      stderr: errorMessage(error),
    })
  }
}

// ─── setCwd() ─────────────────────────────────────────────────────

/**
 * Set the current working directory.
 */
export function setCwd(
  ctx: ShellExecContext,
  path: string,
  relativeTo?: string,
): void {
  const resolved = isAbsolute(path)
    ? path
    : resolve(relativeTo ?? process.cwd(), path)
  // Resolve symlinks to match the behavior of pwd -P.
  let physicalPath: string
  try {
    const { realpathSync } = require('fs') as typeof import('fs')
    physicalPath = realpathSync(resolved)
  } catch (e) {
    if (isENOENT(e)) {
      throw new ExecError(`Path "${resolved}" does not exist`)
    }
    throw e
  }

  ctx.setCwd(physicalPath)
  if (process.env.NODE_ENV !== 'test') {
    try {
      logEvent('tengu_shell_set_cwd', {
        success: true,
      })
    } catch (_error) {
      // Ignore logging errors to prevent test failures
    }
  }
}
