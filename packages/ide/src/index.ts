import type { RuntimeHandle } from './contracts.js'

export type { RuntimeHandle, RuntimeStatus } from './contracts.js'
export * from './errors.js'

export function createRuntimeHandle(): RuntimeHandle {
  return { status: 'inactive' }
}
