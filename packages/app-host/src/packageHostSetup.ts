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
  getGlobalClaudeFile?: () => string
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
  // V7 — extra bindings passed through to subsystem packages.
  // ALL require('src/...') calls stay in src/services/packageHostSetup.ts;
  // packages/app-host just forwards the resolved values.
  extraConfigBindings?: Record<string, unknown>
  extraPermissionBindings?: Record<string, unknown>
  extraMemoryBindings?: Record<string, unknown>
  extraAgentBindings?: Record<string, unknown>
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
    getGlobalClaudeFile: resolvers.getGlobalClaudeFile,
    getProjectRoot: resolvers.getProjectRoot,
    logDebug: resolvers.logDebug,
    getMcpErrorsByScope: resolvers.getMcpErrorsByScope,
    ...resolvers.extraConfigBindings,
  } as any)

  installPermissionHostBindings({
    now,
    logDebug: resolvers.logDebug,
    ...resolvers.extraPermissionBindings,
  } as any)

  installMemoryHostBindings({
    now,
    logDebug: resolvers.logDebug,
    ...resolvers.extraMemoryBindings,
  } as any)

  installAgentHostBindings({
    now,
    logDebug: resolvers.logDebug,
    ...resolvers.extraAgentBindings,
  } as any)

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
