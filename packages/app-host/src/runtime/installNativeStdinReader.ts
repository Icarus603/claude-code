/**
 * Wire the native stdin reader (stdin-napi) into @anthropic/ink's App via
 * setAppCallbacks. App reads keystrokes through this reader instead of
 * process.stdin's 'data' event, bypassing Bun standalone's libuv TTY poll bug
 * (the stream goes silent after an Ink mount→unmount→re-mount cycle — see
 * packages/stdin-napi). When the reader is unsupported (win32, non-tty, or a
 * .node load failure) App falls back to the standard process.stdin path, so
 * this injection is always safe to install.
 *
 * Installed from the runtime bootstrap seam (bootstrap.ts) so it runs once,
 * before any Ink render.
 */
import { setAppCallbacks } from '@anthropic/ink'
import { isReaderSupported, startReader } from 'stdin-napi'
import { logForDebugging } from '@claude-code/local-observability/debug.js'

let installed = false

export function installNativeStdinReader(): void {
  if (installed) return
  installed = true

  // Opt-out escape hatch: if the reader ever misbehaves on a user's terminal,
  // CLAUDE_CODE_NATIVE_STDIN=0 forces the standard process.stdin path.
  if (process.env.CLAUDE_CODE_NATIVE_STDIN === '0') {
    logForDebugging('[stdin] native reader disabled via CLAUDE_CODE_NATIVE_STDIN=0')
    return
  }

  setAppCallbacks({
    nativeStdinReader: {
      isSupported: () => {
        try {
          return isReaderSupported()
        } catch {
          return false
        }
      },
      // redirect_fd0=false: read fd 0 directly. App.tsx destroy()s Bun's
      // stdin (closing Bun's internal tty handle) BEFORE this runs, so the
      // rust reader owns fd 0 alone — no dup2 redirect needed.
      start: onChunk => startReader(false, onChunk),
    },
  })
  logForDebugging('[stdin] native reader callbacks installed')
}

installNativeStdinReader()
