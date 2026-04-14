import type {
  InitBridgeOptions,
  ReplBridgeHandle,
} from '../src/contracts.js'

export class NullBridgeRuntime {
  async bridgeMain(_args: string[]): Promise<void> {}

  buildBridgeConnectUrl(environmentId: string): string {
    return `https://example.test/code?bridge=${environmentId}`
  }

  extractInboundMessageFields(message: unknown): unknown {
    return message
  }

  async resolveAndPrepend(
    _message: unknown,
    content: string | unknown[],
  ): Promise<string | unknown[]> {
    return content
  }

  async initReplBridge(
    _options?: InitBridgeOptions,
  ): Promise<ReplBridgeHandle | null> {
    return null
  }
}

export function createScriptedBridgeHandle(
  overrides: Partial<ReplBridgeHandle> = {},
): ReplBridgeHandle {
  return {
    bridgeSessionId: 'bridge-session',
    environmentId: 'env-test',
    sessionIngressUrl: 'https://example.test/ingress',
    writeMessages: () => {},
    writeSdkMessages: () => {},
    sendControlRequest: () => {},
    sendControlResponse: () => {},
    sendControlCancelRequest: () => {},
    sendResult: () => {},
    teardown: async () => {},
    ...overrides,
  }
}
