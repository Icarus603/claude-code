import type { ToolUseContext } from '@claude-code/tool-registry/Tool.js'

import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { errorMessage } from '@claude-code/local-observability/errorHelpers.js'
import { withResolvers } from '@claude-code/local-observability/utils/withResolvers.js'
import { isLockHeldLocally, releaseComputerUseLock } from 'src/utils/computerUse/computerUseLock.js'
import { unregisterEscHotkey } from 'src/utils/computerUse/escHotkey.js'

// cu.apps.unhide is NOT one of the four @MainActor methods wrapped by
// drainRunLoop's 30s backstop. On abort paths (where the user hit Ctrl+C
// because something was slow) a hang here would wedge the abort. Generous
// timeout — unhide should be ~instant; if it takes 5s something is wrong
// and proceeding is better than waiting. The Swift call continues in the
// background regardless; we just stop blocking on it.
const UNHIDE_TIMEOUT_MS = 5000

/**
 * Turn-end cleanup for the chicago MCP surface: auto-unhide apps that
 * `prepareForAction` hid, then release the file-based lock.
 *
 * Called from three sites: natural turn end (`stopHooks.ts`), abort during
 * streaming (`query.ts` aborted_streaming), abort during tool execution
 * (`query.ts` aborted_tools). All three reach this via dynamic import gated
 * on `feature('CHICAGO_MCP')`. `executor.js` (which pulls both native
 * modules) is dynamic-imported below so non-CU turns don't load native
 * modules just to no-op.
 *
 * No-ops cheaply on non-CU turns: both gate checks are zero-syscall.
 */
// Local typed view of the slice of AppState this module touches. AppState
// itself is typed as `unknown` at the V7 boundary (§7.2), so we narrow here.
type ComputerUseAppStateSlice = {
  computerUseMcpState?: {
    hiddenDuringTurn?: Set<string>
    allowedApps?: string[]
  }
}

export async function cleanupComputerUseAfterTurn(
  ctx: Pick<
    ToolUseContext,
    'getAppState' | 'setAppState' | 'sendOSNotification'
  >,
): Promise<void> {
  const appState = ctx.getAppState() as ComputerUseAppStateSlice

  const hidden = appState.computerUseMcpState?.hiddenDuringTurn
  if (hidden && hidden.size > 0) {
    const { unhideComputerUseApps } = await import('src/utils/computerUse/executor.js')
    const unhide = unhideComputerUseApps([...hidden]).catch(err =>
      logForDebugging(
        `[Computer Use MCP] auto-unhide failed: ${errorMessage(err)}`,
      ),
    )
    const timeout = withResolvers<void>()
    const timer = setTimeout(timeout.resolve, UNHIDE_TIMEOUT_MS)
    await Promise.race([unhide, timeout.promise]).finally(() =>
      clearTimeout(timer),
    )
    ctx.setAppState((prev: unknown) => {
      const slice = prev as ComputerUseAppStateSlice
      if (slice.computerUseMcpState?.hiddenDuringTurn === undefined) return prev
      return {
        ...(slice as object),
        computerUseMcpState: {
          ...slice.computerUseMcpState,
          hiddenDuringTurn: undefined,
        },
      }
    })
  }

  // Zero-syscall pre-check so non-CU turns don't touch disk. Release is still
  // idempotent (returns false if already released or owned by another session).
  if (!isLockHeldLocally()) return

  // Unregister before lock release so the pump-retain drops as soon as the
  // CU session ends. Idempotent — no-ops if registration failed at acquire.
  // Swallow throws so a NAPI unregister error never prevents lock release —
  // a held lock blocks the next CU session with "in use by another session".
  try {
    unregisterEscHotkey()
  } catch (err) {
    logForDebugging(
      `[Computer Use MCP] unregisterEscHotkey failed: ${errorMessage(err)}`,
    )
  }

  if (await releaseComputerUseLock()) {
    ctx.sendOSNotification?.({
      message: 'Claude is done using your computer',
      notificationType: 'computer_use_exit',
    })
  }
}
