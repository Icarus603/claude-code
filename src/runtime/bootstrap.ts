import { installPackageHostBindings } from '@claude-code/app-host/packageHostSetup'
import { createInteractiveSessionStore } from '../state/sessionStores.js'
import { syncRuntimeHandlesFromAppState } from './runtimeHandles.js'
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
    createInteractiveStore: initialState =>
      createInteractiveSessionStore(initialState as any),
    getConfigHomeDir: () => getClaudeConfigHomeDir(),
    getProjectRoot: () => findCanonicalGitRoot(getCwd()),
    logDebug: (message, metadata) => logForDebugging(message, metadata as any),
    now: () => Date.now(),
    syncRuntimeHandlesFromAppState: (handles, state) =>
      syncRuntimeHandlesFromAppState(handles, state as any),
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
