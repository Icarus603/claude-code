import type { RemoteSessionConfig } from '../src/contracts.js'

export class InMemoryServerRuntime {
  constructor(
    private readonly sessions: RemoteSessionConfig[] = [],
  ) {}

  listSessions(): RemoteSessionConfig[] {
    return [...this.sessions]
  }
}

export function createRemoteSessionConfigFixture(
  overrides: Partial<RemoteSessionConfig> = {},
): RemoteSessionConfig {
  return {
    sessionId: 'session-test',
    getAccessToken: () => 'token',
    orgUuid: 'org-test',
    hasInitialPrompt: false,
    viewerOnly: false,
    ...overrides,
  }
}
