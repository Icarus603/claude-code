export type RuntimeStatus = 'inactive' | 'active'

export type RuntimeHandle = {
  status: RuntimeStatus
}

export type RemoteSessionConfig = {
  sessionId: string
  getAccessToken: () => string
  orgUuid: string
  hasInitialPrompt?: boolean
  viewerOnly?: boolean
}
