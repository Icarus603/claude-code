import { installPackageHostBindings } from '../packageHostSetup.js'
import { createInteractiveSessionStore } from '@claude-code/agent/sessionStores.js'
import { syncRuntimeHandlesFromAppState } from './runtimeHandles.js'
import { getCwd } from '../bootstrap/cwd.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { getClaudeConfigHomeDir } from '@claude-code/config/env/utils'
import { getGlobalClaudeFile } from '@claude-code/config/env/paths'
import { findCanonicalGitRoot } from '@claude-code/storage/git.js'
import { setCwdFn, setDjb2HashFn } from '@claude-code/storage/cache-paths'
import { getFsImplementation } from '@claude-code/storage/fsOperations.js'
import { djb2Hash } from '@claude-code/config/hash'

// Wire storage cache-paths to host-aware cwd + hash before any consumer touches
// CACHE_PATHS. Previously lived in src/utils/cachePaths.ts (deleted in #136
// follow-up); moved here so the side-effect runs on every host bootstrap.
// eslint-disable-next-line custom-rules/no-top-level-side-effects
setCwdFn(() => getFsImplementation().cwd())
// eslint-disable-next-line custom-rules/no-top-level-side-effects
setDjb2HashFn(djb2Hash)
import {
  buildAgentHostExtraBindings,
  buildMemoryHostExtraBindings,
  buildPermissionHostExtraBindings,
} from '@claude-code/agent/agentHostBindings.js'

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
    extraAgentBindings: buildAgentHostExtraBindings(),
    extraPermissionBindings: buildPermissionHostExtraBindings(),
    extraMemoryBindings: buildMemoryHostExtraBindings(),
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
  // local-observability (Wave-1 leaf) has its own _deps setter surface;
  // its bindings don't flow through app-host's installPackageHostBindings
  // because app-host itself depends on local-observability.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./installLocalObservabilityBindings.js')
  // config/env (Wave-1 leaf) — wire env setters used by paths.ts / dynamic.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./installConfigEnvBindings.js')
  // output (Wave-2 leaf) — wire setters used by formatters/capture/asciicast.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./installOutputBindings.js')
  // config/plugin (Wave-1 subtree) — wire the 50+ setters for the plugin
  // subsystem that was migrated out of src/utils/plugins/ in Round 4.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./installPluginBindings.js')
  runtimeSkeletonBindingsInstalled = true
}

installRuntimeSkeletonBindings()
