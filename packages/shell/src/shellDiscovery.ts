/**
 *
 */
import { execFileSync } from 'child_process'
import { constants as fsConstants, accessSync } from 'fs'
import memoize from 'lodash-es/memoize.js'
import type { ShellExecContext } from './context.js'
import { logForDebugging } from './_deps.js'
import { createBashShellProvider } from './providers/bashProvider.js'
import { getCachedPowerShellPath } from './providers/powershellDetection.js'
import { createPowerShellProvider } from './providers/powershellProvider.js'
import type { ShellConfig, ShellProvider, ShellType } from './types.js'


function isExecutable(shellPath: string): boolean {
  try {
    accessSync(shellPath, fsConstants.X_OK)
    return true
  } catch (_err) {
    // Fallback for Nix and other environments where X_OK check might fail
    try {
      execFileSync(shellPath, ['--version'], {
        timeout: 1000,
        stdio: 'ignore',
      })
      return true
    } catch {
      return false
    }
  }
}


/**
 * Determines the best available shell to use.
 */
export async function findSuitableShell(
  whichFn: (command: string) => Promise<string | null>,
  signal?: AbortSignal,
): Promise<string> {
  // Check for explicit shell override first
  const shellOverride = process.env.CLAUDE_CODE_SHELL
  if (shellOverride) {
    const isSupported =
      shellOverride.includes('bash') || shellOverride.includes('zsh')
    if (isSupported && isExecutable(shellOverride)) {
      logForDebugging(`Using shell override: ${shellOverride}`)
      return shellOverride
    } else {
      logForDebugging(
        `CLAUDE_CODE_SHELL="${shellOverride}" is not a valid bash/zsh path, falling back to detection`,
      )
    }
  }

  // Check user's preferred shell from environment
  const env_shell = process.env.SHELL
  const isEnvShellSupported =
    env_shell && (env_shell.includes('bash') || env_shell.includes('zsh'))
  const preferBash = env_shell?.includes('bash')

  // Try to locate shells using which
  const [zshPath, bashPath] = await Promise.all([whichFn('zsh'), whichFn('bash')])

  // Populate shell paths from which results and fallback locations
  const shellPaths = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']

  // Order shells based on user preference
  const shellOrder = preferBash ? ['bash', 'zsh'] : ['zsh', 'bash']
  const supportedShells = shellOrder.flatMap(shell =>
    shellPaths.map(path => `${path}/${shell}`),
  )

  // Add discovered paths to the beginning of our search list
  if (preferBash) {
    if (bashPath) supportedShells.unshift(bashPath)
    if (zshPath) supportedShells.push(zshPath)
  } else {
    if (zshPath) supportedShells.unshift(zshPath)
    if (bashPath) supportedShells.push(bashPath)
  }

  // Always prioritize SHELL env variable if it's a supported shell type
  if (isEnvShellSupported && isExecutable(env_shell)) {
    supportedShells.unshift(env_shell)
  }

  const shellPath = supportedShells.find(shell => shell && isExecutable(shell))

  if (!shellPath) {
    throw new Error(
      'No suitable shell found. Claude CLI requires a Posix shell environment. ' +
        'Please ensure you have a valid shell installed and the SHELL environment variable set.',
    )
  }

  return shellPath
}


/**
 */
async function getShellConfigImpl(
  ctx: Pick<ShellExecContext, 'getSessionEnvVars' | 'getSessionEnvironmentScript' | 'ensureTmuxSocket' | 'hasTmuxToolBeenUsed' | 'getTmuxEnv' | 'which'>,
): Promise<ShellConfig> {
  const binShell = await findSuitableShell(ctx.which)
  const provider = await createBashShellProvider(binShell, ctx)
  return { provider }
}

/**
 * Memoized shell config factory.
 * Returns a function that, given a context, returns the cached ShellConfig.
 */
export function createShellConfigFactory(
  ctx: Pick<ShellExecContext, 'getSessionEnvVars' | 'getSessionEnvironmentScript' | 'ensureTmuxSocket' | 'hasTmuxToolBeenUsed' | 'getTmuxEnv' | 'which'>,
): () => Promise<ShellConfig> {
  return memoize(() => getShellConfigImpl(ctx))
}

/**
 */
export function createPsProviderFactory(
  ctx: Pick<ShellExecContext, 'getSessionEnvVars'>,
): () => Promise<ShellProvider> {
  return memoize(async (): Promise<ShellProvider> => {
    const psPath = await getCachedPowerShellPath()
    if (!psPath) {
      throw new Error('PowerShell is not available')
    }
    return createPowerShellProvider(psPath, ctx)
  })
}

/**
 */
export function createProviderResolver(
  ctx: Pick<
    ShellExecContext,
    'getSessionEnvVars' |
    'getSessionEnvironmentScript' |
    'ensureTmuxSocket' |
    'hasTmuxToolBeenUsed' |
    'getTmuxEnv' |
    'which'
  >,
): Record<ShellType, () => Promise<ShellProvider>> {
  const getShellConfig = createShellConfigFactory(ctx)
  const getPsProvider = createPsProviderFactory(ctx)

  return {
    bash: async () => (await getShellConfig()).provider,
    powershell: getPsProvider,
  }
}
