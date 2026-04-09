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
import type { Props as REPLProps } from '@claude-code/app-compat/screens/REPL.js'
import type { AppState } from '@claude-code/app-compat/state/AppStateStore.js'
import type { FpsMetrics } from '@claude-code/app-compat/utils/fpsTracker.js'

export type { Transport } from '@claude-code/app-compat/cli/transports/Transport.js'
export { HybridTransport } from '@claude-code/app-compat/cli/transports/HybridTransport.js'
export {
  SSETransport,
  parseSSEFrames,
} from '@claude-code/app-compat/cli/transports/SSETransport.js'
export {
  WebSocketTransport,
} from '@claude-code/app-compat/cli/transports/WebSocketTransport.js'
export {
  SerialBatchEventUploader,
} from '@claude-code/app-compat/cli/transports/SerialBatchEventUploader.js'
export {
  WorkerStateUploader,
} from '@claude-code/app-compat/cli/transports/WorkerStateUploader.js'

type AppWrapperProps = {
  getFpsMetrics: () => FpsMetrics | undefined
  stats?: import('@claude-code/app-compat/context/stats.js').StatsStore
  initialState: AppState
}

export async function launchRepl(
  root: Root,
  appProps: AppWrapperProps,
  replProps: REPLProps,
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>,
): Promise<void> {
  const { launchRepl: launchReplImpl } = await import(
    '@claude-code/app-compat/replLauncher.js'
  )
  return launchReplImpl(root, appProps, replProps, renderAndRun)
}
