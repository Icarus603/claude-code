/**
 * Manual reorder helpers.
 *
 * The user can shift+up / shift+down a row to reorder within its bucket;
 * the resulting `sortOrder` (or `stateSortOrder` for cross-bucket order)
 * is persisted as a sibling file next to state.json so the order
 * survives daemon restarts.
 *
 * Source: ant reorder action (5092.js:3634 hint + the action-table run).
 */

import { getJobDir, writeSortOrder, writeStateSortOrder } from './fleetStore.js'

/** Persist a per-job sortOrder override. */
export async function setFleetSortOrder(short: string, order: number): Promise<void> {
  await writeSortOrder(getJobDir(short), order)
}

/** Persist a per-job stateSortOrder override (cross-bucket positioning). */
export async function setFleetStateSortOrder(short: string, order: number): Promise<void> {
  await writeStateSortOrder(getJobDir(short), order)
}
