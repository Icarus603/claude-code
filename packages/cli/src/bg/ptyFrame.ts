/**
 * Wire-frame codec for the bg-pty-host socket protocol.
 *
 * 1:1 port of ant 4641.js (HC8 module). Frame layout:
 *
 *   ┌──────────────┬─────┬─────────────┐
 *   │ 4B length BE │ 1B  │ payload N B │
 *   └──────────────┴─────┴─────────────┘
 *
 * Tag byte:
 *   0 (DATA_TAG)   — payload is raw bytes (PTY output / input)
 *   1 (CTRL_TAG)   — payload is UTF-8 JSON `{t: <kind>, ...rest}`
 *
 * Limits: max frame body = 1 MiB (FRAME_SIZE_CAP). Max ring buffer
 * for reattach replay = 256 KiB (RING_BUFFER_BYTES).
 *
 * @dynamicRequire
 */

export const DATA_TAG = 0
export const CTRL_TAG = 1
export const FRAME_HEADER_BYTES = 5
/** ant 4641.js hX_ — ring buffer cap for reattach replay. */
export const RING_BUFFER_BYTES = 256 * 1024
/** ant 4641.js qiH — max frame body size. */
export const FRAME_SIZE_CAP = 1024 * 1024

/**
 * Control-frame payload shape. ant 4702.js dispatches on `.t`:
 *   - `hello`: server → client, on connect (carries replPid + version)
 *   - `live`:  server → client, ring buffer replay finished
 *   - `exit`:  server → client, child has exited (code + signal)
 *   - `resize`: client → server, request PTY resize
 *   - `kill`:  client → server, request signal delivery
 *   - `claim`: daemon → spare worker, hand off intent + cwd (ant 4644.js).
 *   - `reply`: daemon → worker, queue text as next user prompt (ant 4643.js cw6).
 */
export type CtrlFrame =
  | { t: 'hello'; replPid: number; version: string }
  | { t: 'live' }
  | { t: 'exit'; code: number; signal?: string }
  | { t: 'resize'; cols: number; rows: number }
  | { t: 'kill'; sig: 'SIGKILL' | 'SIGTERM' }
  | { t: 'claim'; intent: string; cwd?: string; sessionId?: string }
  | { t: 'reply'; text: string }

export type DecodedFrame =
  | { kind: typeof DATA_TAG; payload: Buffer }
  | { kind: typeof CTRL_TAG; ctrl: CtrlFrame }

/**
 * Encode raw bytes into a DATA frame. Mirrors ant SX_ (4641.js:13-17).
 */
export function encodeDataFrame(payload: Buffer | string): Buffer {
  const body =
    typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
  const out = Buffer.allocUnsafe(FRAME_HEADER_BYTES + body.length)
  out.writeUInt32BE(body.length, 0)
  out.writeUInt8(DATA_TAG, 4)
  body.copy(out, FRAME_HEADER_BYTES)
  return out
}

/**
 * Encode a control object into a CTRL frame. Mirrors ant Vm (4641.js:18-22).
 */
export function encodeCtrlFrame(ctrl: CtrlFrame): Buffer {
  const body = Buffer.from(JSON.stringify(ctrl), 'utf8')
  const out = Buffer.allocUnsafe(FRAME_HEADER_BYTES + body.length)
  out.writeUInt32BE(body.length, 0)
  out.writeUInt8(CTRL_TAG, 4)
  body.copy(out, FRAME_HEADER_BYTES)
  return out
}

/**
 * Stateful frame decoder. Returns a feed-fn that accepts socket
 * chunks and invokes `onFrame` for each complete frame. On error,
 * invokes `onError(message)` and stops processing further input.
 *
 * Mirrors ant Qw6 (4641.js:23-55). Holds a single Buffer of pending
 * bytes between calls; concat overhead is `O(n)` per frame which is
 * fine for typical PTY traffic but could be tightened with a queue
 * if profiles ever show it as a hot path.
 */
export function createFrameDecoder(
  onFrame: (f: DecodedFrame) => void,
  onError: (msg: string) => void,
): (chunk: Buffer) => void {
  let pending = Buffer.alloc(0)
  let stopped = false
  return (chunk: Buffer) => {
    if (stopped) return
    pending =
      pending.length === 0
        ? Buffer.from(chunk)
        : Buffer.from(Buffer.concat([pending, chunk]))
    while (pending.length >= FRAME_HEADER_BYTES) {
      const len = pending.readUInt32BE(0)
      if (len > FRAME_SIZE_CAP) {
        stopped = true
        onError(`frame too large (${len} > ${FRAME_SIZE_CAP})`)
        return
      }
      const total = FRAME_HEADER_BYTES + len
      if (pending.length < total) return
      const tag = pending.readUInt8(4)
      const body = pending.subarray(FRAME_HEADER_BYTES, total)
      pending = pending.subarray(total)
      if (tag === DATA_TAG) {
        onFrame({ kind: DATA_TAG, payload: Buffer.from(body) })
      } else if (tag === CTRL_TAG) {
        let parsed: CtrlFrame
        try {
          parsed = JSON.parse(body.toString('utf8')) as CtrlFrame
        } catch {
          stopped = true
          onError('bad ctrl json')
          return
        }
        onFrame({ kind: CTRL_TAG, ctrl: parsed })
      } else {
        stopped = true
        onError(`unknown frame kind ${tag}`)
        return
      }
    }
  }
}
