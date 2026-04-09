export type { CliHostBindings } from './contracts.js'
export { getCliHostBindings, installCliHostBindings } from './host.js'

export {
  createHeadlessSession,
  createHeadlessStore,
  getHeadlessCommands,
  runHeadless,
} from './headless.js'

export type {
  HeadlessRunOptions,
  HeadlessSessionParams,
  HeadlessStoreParams,
} from './headless.js'

import type React from 'react'
import type { Root } from '@anthropic/ink'
import type { Props as REPLProps } from '@cc-app/screens/REPL.js'
import type { AppState } from '@cc-app/state/AppStateStore.js'
import type { FpsMetrics } from '@cc-app/utils/fpsTracker.js'

export type { Transport } from '@cc-app/cli/transports/Transport.js'
export { HybridTransport } from '@cc-app/cli/transports/HybridTransport.js'
export {
  SSETransport,
  parseSSEFrames,
} from '@cc-app/cli/transports/SSETransport.js'
export {
  WebSocketTransport,
} from '@cc-app/cli/transports/WebSocketTransport.js'
export {
  SerialBatchEventUploader,
} from '@cc-app/cli/transports/SerialBatchEventUploader.js'
export {
  WorkerStateUploader,
} from '@cc-app/cli/transports/WorkerStateUploader.js'

type AppWrapperProps = {
  getFpsMetrics: () => FpsMetrics | undefined
  stats?: import('@cc-app/context/stats.js').StatsStore
  initialState: AppState
}

export async function launchRepl(
  root: Root,
  appProps: AppWrapperProps,
  replProps: REPLProps,
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>,
): Promise<void> {
  const { launchRepl: launchReplImpl } = await import(
    '@cc-app/replLauncher.js'
  )
  return launchReplImpl(root, appProps, replProps, renderAndRun)
}
