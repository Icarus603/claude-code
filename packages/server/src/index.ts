import type { RemoteSessionConfig, RuntimeHandle } from './contracts.js'

export type {
  RemoteSessionConfig,
  RuntimeHandle,
  RuntimeStatus,
} from './contracts.js'
export * from './errors.js'

export function createRuntimeHandle(): RuntimeHandle {
  return { status: 'inactive' }
}

export function createRemoteSessionConfig(
  sessionId: string,
  getAccessToken: () => string,
  orgUuid: string,
  hasInitialPrompt = false,
  viewerOnly = false,
): RemoteSessionConfig {
  return {
    sessionId,
    getAccessToken,
    orgUuid,
    hasInitialPrompt,
    viewerOnly,
  }
}
