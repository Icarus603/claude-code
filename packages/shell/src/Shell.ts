import {
  createPsProviderFactory,
  createShellConfigFactory,
  exec as execWithShellPackage,
  findSuitableShell as findSuitableShellWithPackage,
  MAX_TASK_OUTPUT_BYTES,
  setCreateTaskOutputFn,
  setGetSandboxTmpDirNameFn,
  type ExecOptions,
  type ExecResult,
  type ShellCommand,
  type ShellConfig,
  type ShellExecContext,
  type ShellProvider,
  type ShellType,
  type TaskOutputPort,
} from './index.js'
import memoize from 'lodash-es/memoize.js'
import { isAbsolute, resolve } from 'path'
import { getOriginalCwd, getSessionId, setCwdState } from '@claude-code/app-host/bootstrap/state.js'
import { generateTaskId } from '@claude-code/tool-registry/Task.js'
import { pwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { isENOENT } from '@claude-code/local-observability/errorHelpers.js'
import { getFsImplementation } from '@claude-code/storage/fsOperations.js'
import { onCwdChangedForHooks } from '@claude-code/agent/fileChangedWatcher.js'
import { getClaudeTempDirName } from '@claude-code/permission/filesystem'
import { getPlatform } from '@claude-code/config/platform'
import { logEvent } from '@claude-code/local-observability'
import { SandboxManager } from './sandbox/sandbox-adapter.js'
import { invalidateSessionEnvCache } from '@claude-code/storage/sessionEnvironment.js'
import { getSessionEnvironmentScript } from '@claude-code/storage/sessionEnvironment.js'
import { getSessionEnvVars } from '@claude-code/storage/sessionEnvVars.js'
import { getTaskOutputDir } from '@claude-code/storage/task/diskOutput.js'
import { TaskOutput } from '@claude-code/tool-registry/task/TaskOutput.js'
import { ensureSocketInitialized, getClaudeTmuxEnv, hasTmuxToolBeenUsed } from './terminal/tmuxSocket.js'
import { which } from './which.js'
import {
  posixPathToWindowsPath,
  windowsPathToPosixPath,
} from '@claude-code/storage/windowsPaths.js'

setCreateTaskOutputFn(
  (
    taskId: string,
    onProgress: ((...args: unknown[]) => void) | null,
    stdoutToFile: boolean,
  ): TaskOutputPort =>
    new TaskOutput(
      taskId,
      onProgress as ExecOptions['onProgress'] | null,
      stdoutToFile,
    ),
)
setGetSandboxTmpDirNameFn(getClaudeTempDirName)

function createShellExecContext(): ShellExecContext {
  return {
    getCwd: pwd,
    setCwd: setCwdState,
    getOriginalCwd,
    getSessionId,
    logEvent,
    logForDebugging,
    getSessionEnvVars,
    getSessionEnvironmentScript,
    wrapWithSandbox: (cmd, shell, tmpDir, signal) =>
      SandboxManager.wrapWithSandbox(cmd, shell, tmpDir, signal),
    cleanupAfterSandbox: () => SandboxManager.cleanupAfterCommand(),
    onCwdChanged: onCwdChangedForHooks,
    getTmuxEnv: async () => getClaudeTmuxEnv(),
    ensureTmuxSocket: ensureSocketInitialized,
    hasTmuxToolBeenUsed,
    getPlatform,
    which,
    invalidateSessionEnvCache,
    getTaskOutputDir,
    generateTaskId,
    getMaxTaskOutputBytes: () => MAX_TASK_OUTPUT_BYTES,
    getSandboxTmpDirName: getClaudeTempDirName,
  }
}

const getShellConfigFactory = createShellConfigFactory(createShellExecContext())
const getPsProviderFactory = createPsProviderFactory(createShellExecContext())

export async function findSuitableShell(): Promise<string> {
  return findSuitableShellWithPackage(which)
}

export const getShellConfig = memoize(async (): Promise<ShellConfig> =>
  getShellConfigFactory(),
)

export const getPsProvider = memoize(async (): Promise<ShellProvider> =>
  getPsProviderFactory(),
)

export async function exec(
  command: string,
  abortSignal: AbortSignal,
  shellType: ShellType,
  options?: ExecOptions,
): Promise<ShellCommand> {
  return execWithShellPackage(
    command,
    abortSignal,
    shellType,
    createShellExecContext(),
    options,
  )
}

export function setCwd(path: string, relativeTo?: string): void {
  const absolute = isAbsolute(path)
    ? path
    : resolve(relativeTo || getFsImplementation().cwd(), path)

  let physicalPath: string
  try {
    physicalPath = getFsImplementation().realpathSync(absolute)
  } catch (error) {
    if (isENOENT(error)) {
      throw new Error(`Path "${absolute}" does not exist`)
    }
    throw error
  }

  setCwdState(physicalPath)
  if (process.env.NODE_ENV !== 'test') {
    try {
      logEvent('tengu_shell_set_cwd', { success: true })
    } catch {
      // Telemetry failure must not block setCwd; log sink might be uninstalled
    }
  }
}

export type { ExecOptions, ExecResult }
