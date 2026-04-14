export type BridgeState = 'ready' | 'connected' | 'reconnecting' | 'failed'

export type ReplBridgeHandle = {
  bridgeSessionId: string
  environmentId: string
  sessionIngressUrl: string
  writeMessages(messages: unknown[]): void
  writeSdkMessages(messages: unknown[]): void
  sendControlRequest(request: unknown): void
  sendControlResponse(response: unknown): void
  sendControlCancelRequest(requestId: string): void
  sendResult(): void
  teardown(): Promise<void>
}

export type InitBridgeOptions = {
  onInboundMessage?: (message: unknown) => void | Promise<void>
  onPermissionResponse?: (response: unknown) => void
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: string,
  ) => { ok: true } | { ok: false; error: string }
  onStateChange?: (state: BridgeState, detail?: string) => void
  initialMessages?: unknown[]
  initialName?: string
  getMessages?: () => unknown[]
  previouslyFlushedUUIDs?: Set<string>
  perpetual?: boolean
  outboundOnly?: boolean
  tags?: string[]
}

export type BridgeHostBindings = {
  bridgeMain: (args: string[]) => Promise<void>
  buildBridgeConnectUrl: (
    environmentId: string,
    ingressUrl?: string,
  ) => string
  extractInboundMessageFields: (message: unknown) => unknown
  resolveAndPrepend: (
    message: unknown,
    content: string | unknown[],
  ) => Promise<string | unknown[]>
  initReplBridge: (
    options?: InitBridgeOptions,
  ) => Promise<ReplBridgeHandle | null>
  getBridgeDisabledReason?: () => Promise<string | null>
  isCcrMirrorEnabled?: () => boolean
  isBridgeEnabledBlocking?: () => Promise<boolean>
  clearTrustedDeviceToken?: () => void
  enrollTrustedDevice?: () => Promise<void>
  getTrustedDeviceToken?: () => string | undefined
}
