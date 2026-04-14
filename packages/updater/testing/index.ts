import type { RuntimeHandle } from '../src/contracts.js'

export function createInactiveUpdaterHandle(): RuntimeHandle {
  return { status: 'inactive' }
}
