// V7 §8.21 — bridge integration public surface.
import {
  type InitBridgeOptions,
  type ReplBridgeHandle,
} from './contracts.js'
import { getBridgeHostBindings, installBridgeHostBindings } from './host.js'

export * from './contracts.js'
export * from './errors.js'
export { getBridgeHostBindings, installBridgeHostBindings } from './host.js'

export async function bridgeMain(args: string[]): Promise<void> {
  return getBridgeHostBindings().bridgeMain(args)
}

export function buildBridgeConnectUrl(
  environmentId: string,
  ingressUrl?: string,
): string {
  return getBridgeHostBindings().buildBridgeConnectUrl(environmentId, ingressUrl)
}

export function extractInboundMessageFields(message: unknown): unknown {
  return getBridgeHostBindings().extractInboundMessageFields(message)
}

export function resolveAndPrepend(
  message: unknown,
  content: string | unknown[],
): Promise<string | unknown[]> {
  return getBridgeHostBindings().resolveAndPrepend(message, content)
}

export function initReplBridge(
  options?: InitBridgeOptions,
): Promise<ReplBridgeHandle | null> {
  return getBridgeHostBindings().initReplBridge(options)
}

export function getBridgeDisabledReason(): Promise<string | null> {
  return getBridgeHostBindings().getBridgeDisabledReason?.() ?? Promise.resolve(null)
}

export function isCcrMirrorEnabled(): boolean {
  return getBridgeHostBindings().isCcrMirrorEnabled?.() ?? false
}

export async function isBridgeEnabledBlocking(): Promise<boolean> {
  return getBridgeHostBindings().isBridgeEnabledBlocking?.() ?? false
}

export function clearTrustedDeviceToken(): void {
  getBridgeHostBindings().clearTrustedDeviceToken?.()
}

export function enrollTrustedDevice(): Promise<void> {
  return getBridgeHostBindings().enrollTrustedDevice?.() ?? Promise.resolve()
}

export function getTrustedDeviceToken(): string | undefined {
  return getBridgeHostBindings().getTrustedDeviceToken?.()
}
