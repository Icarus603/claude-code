export type { CliHostBindings, StructuredIOOptions } from './contracts.js'
export { getCliHostBindings, installCliHostBindings } from './host.js'

export {
  createHeadlessSession,
  createHeadlessStore,
  getHeadlessCommands,
} from './headless.js'
export { runHeadless } from './headless/sdk/session/run.js'

export { getStructuredIO } from './transport.js'

export { handleOrphanedPermissionResponse } from './headless/handleOrphanedPermissionResponse.js'
export type {
  OrphanedPermissionDeps,
  OrphanedPermissionMessage,
  OrphanedPermissionResult,
  OrphanedAssistantMessage,
} from './headless/handleOrphanedPermissionResponse.js'

export type {
  HeadlessRunOptions,
  HeadlessSessionParams,
  HeadlessStoreParams,
} from './headless.js'
export type { Transport } from './transports.js'
export {
  HybridTransport,
  parseSSEFrames,
  SSETransport,
  SerialBatchEventUploader,
  WebSocketTransport,
  WorkerStateUploader,
} from './transports.js'

export { joinPromptValues, canBatchWith } from './headless/sdk/session/prompt-utils.js'
export { createCanUseToolWithPermissionPrompt, getCanUseToolFn } from './headless/sdk/control/permission-helpers.js'
export { handleInitializeRequest, handleSetPermissionMode, handleChannelEnable, reregisterChannelHandlerAfterReconnect } from './headless/sdk/control/handlers.js'
export { loadInitialMessages, removeInterruptedMessage, emitLoadError } from './headless/sdk/session/load.js'
export type { LoadInitialMessagesResult } from './headless/sdk/session/load.js'
export { runHeadlessStreaming, handleRewindFiles } from './headless/sdk/session/run-streaming.js'

export { getTeammateModeSnapshot, isBeingDebugged, logManagedSettings } from './entry/bootstrap-utils.js'
export { createSortedHelpConfig, createMainProgram } from './entry/commander.js'
