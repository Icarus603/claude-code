import {
  createPsProviderFactory,
  createShellConfigFactory,
  exec as execWithShellPackage,
  findSuitableShell as findSuitableShellWithPackage,
  MAX_TASK_OUTPUT_BYTES,
  setCreateTaskOutputFn,
  setGetPlatformFn,
  setGetSandboxTmpDirNameFn,
  setPosixPathToWindowsPathFn,
  setWhichFn,
  setWindowsPathToPosixPathFn,
  type ExecOptions,
  type ExecResult,
  type ShellCommand,
  type ShellConfig,
  type ShellExecContext,
  type ShellProvider,
  type ShellType,
  type TaskOutputPort,
} from '@claude-code/shell'
import memoize from 'lodash-es/memoize.js'
import { isAbsolute, resolve } from 'path'
import { getOriginalCwd, getSessionId, setCwdState } from '../bootstrap/state.js'
import { generateTaskId } from '../Task.js'
import { pwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { isENOENT } from './errors.js'
import { getFsImplementation } from './fsOperations.js'
import { onCwdChangedForHooks } from './hooks/fileChangedWatcher.js'
import { getClaudeTempDirName } from '@claude-code/permission/filesystem'
import { getPlatform } from './platform.js'
import { logEvent } from '../services/eventLogger.js'
import { SandboxManager } from './sandbox/sandbox-adapter.js'
import { invalidateSessionEnvCache } from './sessionEnvironment.js'
import { getSessionEnvironmentScript } from './sessionEnvironment.js'
import { getSessionEnvVars } from './sessionEnvVars.js'
import { getTaskOutputDir } from './task/diskOutput.js'
import { TaskOutput } from './task/TaskOutput.js'
import { ensureSocketInitialized, getClaudeTmuxEnv, hasTmuxToolBeenUsed } from './tmuxSocket.js'
import { which } from './which.js'
import {
  posixPathToWindowsPath,
  windowsPathToPosixPath,
} from './windowsPaths.js'

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
setGetPlatformFn(getPlatform)
setWhichFn(which)
setWindowsPathToPosixPathFn(windowsPathToPosixPath)
setPosixPathToWindowsPathFn(posixPathToWindowsPath)

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
    }
  }
}

export type { ExecOptions, ExecResult }
