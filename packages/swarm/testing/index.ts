import type { SwarmHostDeps } from '../src/index.js'

export function createSwarmHostDepsFixture(
  overrides: Partial<SwarmHostDeps> = {},
): SwarmHostDeps {
  return {
    now: () => Date.now(),
    randomId: () => 'swarm-test-id',
    logDebug: () => {},
    emitEvent: () => {},
    mailbox: {
      readUnreadMessages: async () => [],
      markMessagesAsRead: async () => {},
      sendMessage: async () => {},
    },
    permissions: {
      requestPermission: async () => ({ behavior: 'allow', updatedInput: {} }),
    },
    ...overrides,
  } as unknown as SwarmHostDeps
}
