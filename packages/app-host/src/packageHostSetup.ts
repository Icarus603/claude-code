import { installAgentHostBindings } from '@claude-code/agent'
import { installCliHostBindings } from '@claude-code/cli'
import { installConfigHostBindings } from '@claude-code/config'
import { installMemoryHostBindings } from '@claude-code/memory'
import { installPermissionHostBindings } from '@claude-code/permission'
import {
  installHostBindings,
  installInteractiveSessionHostBindings,
} from './host.js'
import type { HostSessionStore, RuntimeHandles } from './contracts.js'

let packageHostBindingsInstalled = false

export type PackageHostBindingInstallers = {
  installProviderBindings?: () => void
  installToolRegistryBindings?: () => void
  installCommandRuntimeBindings?: () => void
  installMcpRuntimeBindings?: () => void
  installCliBindings?: () => void
}

export type PackageHostCoreResolvers = {
  createInteractiveStore: (initialState?: unknown) => HostSessionStore
  getConfigHomeDir: () => string
  getProjectRoot: () => string | undefined
  logDebug: (message: string, metadata?: unknown) => void
  now?: () => number
  syncRuntimeHandlesFromAppState: (
    handles: RuntimeHandles,
    state: unknown,
  ) => void
  // V7 §8.6 — bridge from mcp-runtime to config for error aggregation.
  getMcpErrorsByScope?: (scope: string) => Array<{
    file?: string
    path: string
    message: string
    source?: string
  }>
}

export function installCorePackageHostBindings(
  resolvers: PackageHostCoreResolvers,
): void {
  if (packageHostBindingsInstalled) {
    return
  }

  const now = resolvers.now ?? (() => Date.now())

  installConfigHostBindings({
    getConfigHomeDir: resolvers.getConfigHomeDir,
    getProjectRoot: resolvers.getProjectRoot,
    logDebug: resolvers.logDebug,
    // V7 §8.6 — MCP error aggregation injected via host binding so config
    // does not depend on mcp-runtime (integration layer). Lazy-imported
    // because mcp-runtime may not be loaded at config init time.
    getMcpErrorsByScope: resolvers.getMcpErrorsByScope,
  })

  installPermissionHostBindings({
    now,
    logDebug: resolvers.logDebug,
  })

  installMemoryHostBindings({
    now,
    logDebug: resolvers.logDebug,
  })

  installAgentHostBindings({
    now,
    logDebug: resolvers.logDebug,
  })

  installCliHostBindings({
    logDebug: resolvers.logDebug,
  })

  installInteractiveSessionHostBindings({
    createInteractiveStore: resolvers.createInteractiveStore,
    syncRuntimeHandles: resolvers.syncRuntimeHandlesFromAppState,
  })

  packageHostBindingsInstalled = true
}

export function installPackageHostBindings(
  resolvers: PackageHostCoreResolvers,
  installers: PackageHostBindingInstallers = {},
): void {
  installHostBindings({
    installCorePackageBindings: () => installCorePackageHostBindings(resolvers),
    installProviderBindings: installers.installProviderBindings,
    installToolRegistryBindings: installers.installToolRegistryBindings,
    installCommandRuntimeBindings: installers.installCommandRuntimeBindings,
    installMcpRuntimeBindings: installers.installMcpRuntimeBindings,
    installCliBindings:
      installers.installCliBindings ??
      (() => installCorePackageHostBindings(resolvers)),
  })
}

export function resetPackageHostBindingsForTests(): void {
  packageHostBindingsInstalled = false
}
