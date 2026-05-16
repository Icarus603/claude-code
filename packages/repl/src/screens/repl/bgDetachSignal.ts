/**
 * Bg-session detach signal — fires when the user presses left-arrow
 * on an empty prompt inside a PTY-attached bg session.
 *
 * Source: ant 4177.js `$1H()`:
 *   if (!PF_()) return                     // PF_() = CLAUDE_BG_BACKEND==="daemon"
 *   let H = f4K()                          // detach message
 *   ri({type:"detach-request", msg:H})    // daemon RPC
 *   process.stdout.write(w_H(H))          // APC wire format
 *
 * ant has TWO mechanisms because the daemon RPC is the primary path —
 * the stdout APC is a backup. ccb has no daemon, so we play the
 * daemon's role at the ptyHost layer:
 *
 *   1. Write APC sentinel `\x1b_cc-daemon-detach\x1b\\` to stdout.
 *      attachClient's handleLivePaint scans for this and detaches.
 *      BUT — Bun.Terminal MAY parse and consume APC sequences (APC
 *      is a recognized vt control), so this path is unreliable.
 *
 *   2. Open a side-channel connection to pty.sock (path derived from
 *      CLAUDE_JOB_DIR set by spawnPty), send a `t:'detach'` ctrl
 *      frame, close after 50ms. ptyHost's handleCtrl 'detach' case
 *      broadcasts `encodeDataFrame(DETACH_APC_BUF)` to all attached
 *      clients, bypassing the PTY entirely — same outcome as ant's
 *      daemon `onStream.emit(w_H(H.msg))` (4835.js).
 */

import type { Socket } from 'node:net'

export function sendBgDetachSignal(): void {
  process.stdout.write('\x1b_cc-daemon-detach\x1b\\')
  const jobDir = process.env.CLAUDE_JOB_DIR
  if (jobDir === undefined || jobDir === '') return
  void (async () => {
    try {
      const [{ connect }, { join }, { encodeCtrlFrame }] = await Promise.all([
        import('node:net'),
        import('node:path'),
        import('@claude-code/cli/bg/ptyFrame.js'),
      ])
      const sockPath = join(jobDir, 'pty.sock')
      const sock: Socket = connect(sockPath)
      const settle = (): void => {
        try {
          sock.destroy()
        } catch {
          /* best-effort */
        }
      }
      sock.once('error', settle)
      sock.once('connect', () => {
        try {
          sock.write(encodeCtrlFrame({ t: 'detach' }))
          setTimeout(settle, 50)
        } catch {
          settle()
        }
      })
    } catch {
      // best-effort — stdout APC is the primary path
    }
  })()
}
