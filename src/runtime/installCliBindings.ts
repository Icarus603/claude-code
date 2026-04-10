import { installCliHostBindings, type HeadlessStoreParams } from '@claude-code/cli'
import { runHeadless } from '../cli/print.js'
import { createHeadlessSessionStore } from '../state/sessionStores.js'

let cliBindingsInstalled = false

export function installCliBindings(): void {
  if (cliBindingsInstalled) return

  installCliHostBindings({
    createHeadlessStore: params =>
      createHeadlessSessionStore(params as HeadlessStoreParams),
    runHeadless: (...args) => runHeadless(...(args as Parameters<typeof runHeadless>)),
  })

  cliBindingsInstalled = true
}

installCliBindings()
