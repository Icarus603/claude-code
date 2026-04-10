import type {
  HostFactory,
  InteractiveHost,
  InteractiveSessionHostBindings,
  RuntimeBindingInstallers,
  RuntimeGraph,
} from './contracts.js'
import { createRuntimeGraph } from './runtimeGraph.js'

let runtimeBindingsInstalled = false
let interactiveSessionHostBindings:
  | InteractiveSessionHostBindings<unknown>
  | null = null

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

export function createInteractiveHost<T extends object>(
  factory: HostFactory<T>,
  handles: RuntimeGraph['handles'],
): InteractiveHost<T> {
  const runtimeGraph = createRuntimeGraph(handles)
  const host = factory({ runtimeGraph }) as InteractiveHost<T>

  host.createSession = ({ initialAppState, runtimeHandles }) => {
    const bindings = getInteractiveSessionHostBindings()
    const sessionHandles = runtimeHandles ?? handles
    const store = bindings.createInteractiveStore(initialAppState)
    const syncFromStore = () =>
      bindings.syncRuntimeHandles(sessionHandles, store.getState())

    syncFromStore()
    store.subscribe(syncFromStore)

    return {
      runtimeGraph: createRuntimeGraph(sessionHandles),
      store,
      syncFromStore,
      getRuntimeHandles: () => sessionHandles,
    }
  }

  return host
}

export function createHeadlessHost<T>(
  factory: HostFactory<T>,
  handles: RuntimeGraph['handles'],
): T {
  return factory({ runtimeGraph: createRuntimeGraph(handles) })
}

export function createRemoteHost<T>(
  factory: HostFactory<T>,
  handles: RuntimeGraph['handles'],
): T {
  return factory({ runtimeGraph: createRuntimeGraph(handles) })
}

export function installInteractiveSessionHostBindings<TState = unknown>(
  bindings: InteractiveSessionHostBindings<TState>,
): void {
  interactiveSessionHostBindings =
    bindings as InteractiveSessionHostBindings<unknown>
}

export function getInteractiveSessionHostBindings<
  TState = unknown,
>(): InteractiveSessionHostBindings<TState> {
  if (!interactiveSessionHostBindings) {
    throw new Error(
      'Interactive session host bindings have not been installed.',
    )
  }
  return interactiveSessionHostBindings as InteractiveSessionHostBindings<TState>
}

export function resetHostBindingsForTests(): void {
  runtimeBindingsInstalled = false
  interactiveSessionHostBindings = null
}
