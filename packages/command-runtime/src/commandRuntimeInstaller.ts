import { hasCommandRegistryHostBindings } from './host.js'

let commandRuntimeInstalled = false

export function ensureCommandRuntimeInstalled(): void {
  if (commandRuntimeInstalled || hasCommandRegistryHostBindings()) {
    commandRuntimeInstalled = true
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(`${process.cwd()}/packages/app-host/src/runtime/installCommandRuntimeBindings.js`)
  commandRuntimeInstalled = true
}
