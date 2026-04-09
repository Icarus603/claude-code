export type RuntimeBindingInstallers = {
  installCorePackageBindings?: () => void
  installProviderBindings?: () => void
  installToolRegistryBindings?: () => void
  installCommandRuntimeBindings?: () => void
  installMcpRuntimeBindings?: () => void
  installCliBindings?: () => void
}

export type RuntimeGraph = {
  createdAt: number
  handles: Record<string, unknown>
}

export type HostFactoryOptions = {
  runtimeGraph: RuntimeGraph
}

export type HostFactory<T = unknown> = (
  options: HostFactoryOptions,
) => T
