/**
 * Pure median helper for telemetry aggregation.
 * V7 §3.3 — extracted from REPLView.tsx (iter 19) so the host file
 * does not host arbitrary numeric utilities.
 */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!
}
