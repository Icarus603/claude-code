import type { HostFactory, RuntimeBindingInstallers } from './contracts.js'
import { createRuntimeGraph } from './runtimeGraph.js'

let runtimeBindingsInstalled = false

export function installHostBindings(
  installers: RuntimeBindingInstallers,
): void {
  if (runtimeBindingsInstalled) {
    return
  }

  installers.installCorePackageBindings?.()
  installers.installProviderBindings?.()
  installers.installToolRegistryBindings?.()
  installers.installCommandRuntimeBindings?.()
  installers.installMcpRuntimeBindings?.()
  installers.installCliBindings?.()

  runtimeBindingsInstalled = true
}

export function createInteractiveHost<T>(
  factory: HostFactory<T>,
  handles: Record<string, unknown> = {},
): T {
  return factory({ runtimeGraph: createRuntimeGraph(handles) })
}

export function createHeadlessHost<T>(
  factory: HostFactory<T>,
  handles: Record<string, unknown> = {},
): T {
  return factory({ runtimeGraph: createRuntimeGraph(handles) })
}

export function createRemoteHost<T>(
  factory: HostFactory<T>,
  handles: Record<string, unknown> = {},
): T {
  return factory({ runtimeGraph: createRuntimeGraph(handles) })
}

export function resetHostBindingsForTests(): void {
  runtimeBindingsInstalled = false
}
