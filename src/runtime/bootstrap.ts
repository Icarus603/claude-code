import { installPackageHostBindings } from '@claude-code/app-host/packageHostSetup'
import { getCwd } from '../utils/cwd.js'
import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { findCanonicalGitRoot } from '../utils/git.js'

let runtimeSkeletonBindingsInstalled = false

export function installRuntimeSkeletonBindings(): void {
  if (runtimeSkeletonBindingsInstalled) {
    return
  }

  installPackageHostBindings({
    getConfigHomeDir: () => getClaudeConfigHomeDir(),
    getProjectRoot: () => findCanonicalGitRoot(getCwd()),
    logDebug: (message, metadata) => logForDebugging(message, metadata as any),
    now: () => Date.now(),
  }, {
    installProviderBindings: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./installProviderBindings.js')
    },
    installToolRegistryBindings: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./installToolRegistryBindings.js')
    },
    installCommandRuntimeBindings: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./installCommandRuntimeBindings.js')
    },
    installMcpRuntimeBindings: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./installMcpRuntimeBindings.js')
    },
    installCliBindings: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./installCliBindings.js')
    },
  })
  runtimeSkeletonBindingsInstalled = true
}

installRuntimeSkeletonBindings()
