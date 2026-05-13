/**
 * Image dimension auto-strip retry helper.
 *
 * Port of ant v2.1.136 `Lx9` (parser) + `Zv3` (mutator) — both in
 * resplit/2539.js / 4758.js. When the API returns 400 with a message
 * pinpointing a single image block that exceeds the many-image 2000px
 * limit, the runtime parses the path, strips that one block, and
 * retries (logging `tengu_image_dimension_strip_retry`).
 *
 * Surgical drop semantics:
 *   - Only the offending image is replaced (with a placeholder text
 *     `[Image removed: dimensions exceeded the 2000px limit for
 *     requests with many images]`). Other images in the same message
 *     are untouched.
 *   - Only `role: 'user'` messages are eligible — assistant content
 *     shouldn't contain raw images; if we ever see the coords pointing
 *     at one, return the messages array unchanged (ant Zv3 guard).
 *   - If the coords don't resolve to an image block (the array has
 *     shifted since the API saw it, the block was already stripped,
 *     etc.) we return the input array unchanged.
 *
 * Why not downscale: the API has decided this specific image is too
 * big to accept. Re-compressing locally would be slow and the next
 * upload might still fail. Dropping the image is reliable.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { APIError } from '@anthropic-ai/sdk'

/**
 * Ant `Lx9`. Detect "image-dimensions-exceeded" 400 errors and pull
 * the block coordinates out of the error message. Returns the parsed
 * coords (plus the pixel limit if available, used for telemetry only)
 * or `undefined` when this isn't an image-dimension error.
 *
 * Two patterns must BOTH match — ant uses two `test()`s:
 *   1. `/dimensions exceed max allowed size.*\d+ pixels/` — proves the
 *      error is about image dimensions specifically (not file-size,
 *      page count, request-too-large, etc.).
 *   2. `/messages\.(\d+)\.content\.(\d+)\.image/` — proves the error
 *      pinpoints a single block. Without it we can't safely strip
 *      (could be a bulk error that mentions multiple images).
 *
 * `pixelLimit` is a ccb-only extra (used for telemetry) — ant doesn't
 * capture the number, but the regex still requires it to be present.
 */
export function parseImageDimensionExceededError(
  err: unknown,
):
  | { messageIdx: number; contentIdx: number; pixelLimit?: number }
  | undefined {
  if (!(err instanceof APIError) || err.status !== 400) {
    return undefined
  }
  const msg = err.message ?? ''
  // Ant: `/dimensions exceed max allowed size.*\d+ pixels/.test(H.message)`.
  // NO case-insensitive flag — ant's regex is strictly case-sensitive so
  // a future API wording change would NOT silently break us. We use
  // `exec` instead of `test` to also pull the pixel count for the
  // telemetry side-channel (ccb-specific addition). Note `.*?` (lazy) so
  // the `(\d+) pixels` capture anchors on the LAST number-before-"pixels"
  // boundary — with greedy `.*` plus a capture group, `of 2000` would
  // match "of 2" leaving "000 pixels" stuck. Ant's regex has no capture
  // group so the greedy form is fine there; the ccb additional capture
  // forces lazy matching. The set of strings matched is the same.
  const dimMatch = /dimensions exceed max allowed size.*?(\d+) pixels/.exec(
    msg,
  )
  if (!dimMatch) return undefined
  const coordMatch = /messages\.(\d+)\.content\.(\d+)\.image/.exec(msg)
  if (!coordMatch) return undefined
  return {
    messageIdx: Number(coordMatch[1]),
    contentIdx: Number(coordMatch[2]),
    pixelLimit: Number(dimMatch[1]),
  }
}

/**
 * Ant `Zv3`. Return a NEW messages array with the offending image
 * block replaced by the placeholder text block. Returns the input
 * array reference (NOT a copy) when:
 *   - the target message isn't a user message
 *   - the target message's content isn't an array (string-content user
 *     messages can't carry images)
 *   - the block at `contentIdx` isn't an image (already stripped,
 *     coords stale)
 *
 * Returning the SAME reference on no-op matches ant's contract: the
 * caller uses referential inequality to know whether to retry.
 */
export function stripOversizedImageFromMessages(
  messages: readonly Anthropic.MessageParam[],
  coords: { messageIdx: number; contentIdx: number },
): readonly Anthropic.MessageParam[] {
  const { messageIdx, contentIdx } = coords
  const msg = messages[messageIdx]
  // ant Zv3: `q?.type !== "user" || !Array.isArray(q.message.content)`.
  // ant's message wrapper has `.type` and `.message.content`; SDK's
  // MessageParam has `.role` and `.content` directly. The semantic
  // check is the same — only user-role messages with structured content
  // are eligible.
  if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) {
    return messages
  }
  const block = msg.content[contentIdx]
  if (!block || block.type !== 'image') {
    return messages
  }
  // ant uses `.map((T,A)=>A===_.contentIdx?...:T)` — keep that pattern.
  const newContent = msg.content.map((item, idx) =>
    idx === contentIdx
      ? {
          type: 'text' as const,
          text: '[Image removed: dimensions exceeded the 2000px limit for requests with many images]',
        }
      : item,
  )
  const newMsg: Anthropic.MessageParam = {
    ...msg,
    content: newContent,
  }
  return messages.map((m, idx) => (idx === messageIdx ? newMsg : m))
}
