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
import type { Props as REPLProps } from '../../../src/screens/REPL.js'
import type { AppState } from '../../../src/state/AppStateStore.js'
import type { FpsMetrics } from '../../../src/utils/fpsTracker.js'

export type { Transport } from '../../../src/cli/transports/Transport.js'
export { HybridTransport } from '../../../src/cli/transports/HybridTransport.js'
export {
  SSETransport,
  parseSSEFrames,
} from '../../../src/cli/transports/SSETransport.js'
export {
  WebSocketTransport,
} from '../../../src/cli/transports/WebSocketTransport.js'
export {
  SerialBatchEventUploader,
} from '../../../src/cli/transports/SerialBatchEventUploader.js'
export {
  WorkerStateUploader,
} from '../../../src/cli/transports/WorkerStateUploader.js'

type AppWrapperProps = {
  getFpsMetrics: () => FpsMetrics | undefined
  stats?: import('../../../src/context/stats.js').StatsStore
  initialState: AppState
}

export async function launchRepl(
  root: Root,
  appProps: AppWrapperProps,
  replProps: REPLProps,
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>,
): Promise<void> {
  const { launchRepl: launchReplImpl } = await import(
    '../../../src/replLauncher.js'
  )
  return launchReplImpl(root, appProps, replProps, renderAndRun)
}
