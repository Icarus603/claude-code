import { installBridgeHostBindings } from '@claude-code/bridge'
import { bridgeMain } from './bridgeMain.js'
import { buildBridgeConnectUrl } from './bridgeStatusUtil.js'
import {
  getBridgeDisabledReason,
  isBridgeEnabledBlocking,
  isCcrMirrorEnabled,
} from './bridgeEnabled.js'
import { extractInboundMessageFields } from './inboundMessages.js'
import { resolveAndPrepend } from './inboundAttachments.js'
import { initReplBridge } from './initReplBridge.js'
import {
  clearTrustedDeviceToken,
  enrollTrustedDevice,
  getTrustedDeviceToken,
} from './trustedDevice.js'

let installed = false

export function installBridgeBindings(): void {
  if (installed) {
    return
  }

  installBridgeHostBindings({
    bridgeMain,
    buildBridgeConnectUrl,
    extractInboundMessageFields,
    resolveAndPrepend,
    initReplBridge,
    getBridgeDisabledReason,
    isCcrMirrorEnabled,
    isBridgeEnabledBlocking,
    clearTrustedDeviceToken,
    enrollTrustedDevice,
    getTrustedDeviceToken,
  })

  installed = true
}

installBridgeBindings()
