import { installProviderHostBindings, type ProviderHostBindings } from './host.js'

// Re-export so consumers (app-host) can import ProviderHostBindings via this
// orchestrator module rather than reaching into ./host.js. The original
// import-only form left the type un-exported and broke a downstream import
// in app-host/src/providerHostSetup.ts.
export type { ProviderHostBindings }

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
