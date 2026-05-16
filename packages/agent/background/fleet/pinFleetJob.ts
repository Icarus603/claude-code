/**
 * Pin / unpin a FleetJob. Source: ant pin add/remove path (2507.js:271-304).
 *
 * Concurrent calls are serialised through a single in-flight promise so
 * that rapid Ctrl+P toggles can't race on the pins.json write.
 */

import { readPinSet, writePinSet } from './fleetStore.js'

let inflight: Promise<void> | null = null

/**
 * Add or remove `short` from the pin set, then persist pins.json.
 * Serialises writes through `inflight` to avoid lost updates.
 *
 * Source: ant pin path (2507.js:271-304).
 */
export async function setFleetJobPinned(short: string, pinned: boolean): Promise<void> {
  const prev = inflight ?? Promise.resolve()
  const next = prev.then(async () => {
    const pins = await readPinSet()
    if (pinned) pins.add(short)
    else pins.delete(short)
    await writePinSet(pins)
  })
  inflight = next.catch(() => {})
  return next
}
