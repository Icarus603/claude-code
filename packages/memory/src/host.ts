import type { MemoryHostBindings } from './contracts.js'

let memoryHostBindings: MemoryHostBindings | null = null

export function installMemoryHostBindings(bindings: MemoryHostBindings): void {
  memoryHostBindings = bindings
}

export function getMemoryHostBindings(): MemoryHostBindings {
  if (!memoryHostBindings) {
    throw new Error(
      'Memory host bindings have not been installed. Install host bindings before using @claude-code/memory runtime APIs.',
    )
  }
  return memoryHostBindings
}

