/**
 * Compute the "Completed" bucket visible-row cap.
 *
 * Source: ant kdK (5092.js):
 *   function kdK(H) { return RY(Math.floor(H/5), Xs3, Ps3) }
 *
 * with Xs3 = 3, Ps3 = 10, RY = clamp. Call site: `__ = kdK(CH)` where
 * `CH = s6().rows` — the TERMINAL HEIGHT in rows, NOT the item count.
 *
 *   cap = clamp(floor(terminalRows / 5), 3, 10)
 *
 * So a 30-row terminal → cap=6, a 50-row terminal → cap=10.
 *
 * ccb's earlier port passed the item count by mistake, which made the
 * cap stay at the minimum (3) for any list with fewer than 15 rows —
 * triggering the fold row for even trivial lists.
 */

const DONE_FOLD_MIN = 3
const DONE_FOLD_MAX = 10

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** Source: ant kdK. Param is terminal rows (height), not item count. */
export function doneFoldCap(terminalRows: number): number {
  return clamp(Math.floor(terminalRows / 5), DONE_FOLD_MIN, DONE_FOLD_MAX)
}
