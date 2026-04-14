import { installPackageHostBindings } from '@claude-code/app-host/packageHostSetup'
import { createInteractiveSessionStore } from '../state/sessionStores.js'
import { syncRuntimeHandlesFromAppState } from './runtimeHandles.js'
import { getCwd } from '../utils/cwd.js'
import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { getGlobalClaudeFile } from '../utils/env.js'
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
    getGlobalClaudeFile: () => getGlobalClaudeFile(),
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
  // Bridge bindings are not part of the app-host bootstrap contract yet,
  // but CLI/headless package code imports @claude-code/bridge directly.
  // Install them from the same runtime bootstrap seam.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./installBridgeBindings.js')
  runtimeSkeletonBindingsInstalled = true
}

installRuntimeSkeletonBindings()
