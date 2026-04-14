import type { RuntimeHandle } from '../src/contracts.js'

export function createInactiveTeleportHandle(): RuntimeHandle {
  return { status: 'inactive' }
}
