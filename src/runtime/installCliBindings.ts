import { installCliHostBindings, type HeadlessStoreParams } from '@claude-code/cli'
import { runHeadless } from '@claude-code/cli/print.js'
import { getStructuredIO } from '@claude-code/cli/structuredIOHelper.js'
import { createHeadlessSessionStore } from '../state/sessionStores.js'

let cliBindingsInstalled = false

export function installCliBindings(): void {
  if (cliBindingsInstalled) return

  installCliHostBindings({
    createHeadlessStore: params =>
      createHeadlessSessionStore(params as HeadlessStoreParams),
    runHeadless: (...args) => runHeadless(...(args as Parameters<typeof runHeadless>)),
    getStructuredIO,
  })

  cliBindingsInstalled = true
}

installCliBindings()
