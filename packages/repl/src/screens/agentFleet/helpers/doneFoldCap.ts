/**
 * Compute how many "Completed" rows to display unfolded.
 *
 * Source: ant kdK (5092.js:178-180) — `clamp(floor(rows/5), Xs3, Ps3)`
 * where `Xs3 = 3` (5092.js:4000) and `Ps3 = 10` (5092.js:4001).
 *
 * The done bucket shows at most `cap` rows by default; the rest collapse
 * into a `+N more` fold row that the user can expand.
 */

const DONE_FOLD_MIN = 3
const DONE_FOLD_MAX = 10

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** Source: ant kdK. */
export function doneFoldCap(totalRows: number): number {
  return clamp(Math.floor(totalRows / 5), DONE_FOLD_MIN, DONE_FOLD_MAX)
}
