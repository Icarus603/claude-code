export type { RuntimeHandle, RuntimeStatus } from './contracts.js'

export function createRuntimeHandle(): RuntimeHandle {
  return { status: 'inactive' }
}
