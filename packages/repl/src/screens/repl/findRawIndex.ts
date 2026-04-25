/**
 * Locate a message by 24-char UUID prefix in a message array.
 * deriveUUID preserves the first 24 chars, so renderable uuids can
 * prefix-match the original source — allows lookups across derived
 * (e.g. compacted) and raw streams without an explicit map.
 *
 * V7 §3.3 — extracted from REPLView.tsx (iter 20) so the host file
 * stops accumulating arbitrary array helpers.
 */
export function findRawIndex<M extends { uuid: string }>(
  messages: ReadonlyArray<M>,
  uuid: string,
): number {
  const prefix = uuid.slice(0, 24)
  return messages.findIndex(m => m.uuid.slice(0, 24) === prefix)
}
