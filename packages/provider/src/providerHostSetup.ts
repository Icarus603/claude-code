import { installProviderHostBindings, type ProviderHostBindings } from './host.js'

let providerHostBindingsInstalled = false

export function installProviderRuntimeBindings(
  bindings: ProviderHostBindings,
): void {
  if (providerHostBindingsInstalled) {
    return
  }

  installProviderHostBindings(bindings)
  providerHostBindingsInstalled = true
}

export function resetProviderRuntimeBindingsForTests(): void {
  providerHostBindingsInstalled = false
}
