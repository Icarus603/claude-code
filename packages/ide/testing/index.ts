import type { RuntimeHandle } from '../src/contracts.js'

export function createInactiveIdeHandle(): RuntimeHandle {
  return { status: 'inactive' }
}
