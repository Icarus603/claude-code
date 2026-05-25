import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for anthropic/client.ts header construction vs ant bx
 * (1984.js). These headers control:
 *  - x-app: backend routing/analytics (cli vs cli-bg)
 *  - User-Agent: anonymized version reporting
 *  - X-Claude-Code-Session-Id: backend session correlation
 *  - x-claude-remote-* : SSH-proxy / container deployment markers
 *  - x-client-app: SDK consumer identification
 *  - x-anthropic-additional-protection: extra abuse defense layer
 *
 * Getting any of these wrong silently breaks analytics or routing without
 * any local error — backend dashboards just see traffic stop appearing
 * under the expected dimension.
 */
describe('anthropic/client.ts headers (ant bx 1984.js parity)', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'anthropic', 'client.ts'),
    'utf-8',
  )

  test('x-app: cli-bg for daemon/background sessions, cli otherwise', () => {
    expect(source).toMatch(
      /sessionKind === 'bg'\s*\|\|\s*\n?\s*sessionKind === 'daemon'\s*\|\|\s*\n?\s*sessionKind === 'daemon-worker'/,
    )
    expect(source).toMatch(/'x-app':\s*isBgKind\s*\?\s*'cli-bg'\s*:\s*'cli'/)
  })

  test('User-Agent comes from anthropic host binding (centralized version string)', () => {
    expect(source).toMatch(/'User-Agent':\s*anthropic\.getUserAgent\(\)/)
  })

  test('anthropic-client-platform header sent from getClientPlatform (ant v2.1.150 T2)', () => {
    // Coarse client-surface identifier (cli/vscode/sdk/mcp/remote …) for
    // server-side traffic attribution. Sent on every request, like x-app.
    expect(source).toMatch(
      /'anthropic-client-platform':\s*getClientPlatform\(\)/,
    )
  })

  test('X-Claude-Code-Session-Id surfaces internal session id (backend correlation)', () => {
    expect(source).toMatch(/'X-Claude-Code-Session-Id':\s*anthropic\.getSessionId\(\)/)
  })

  test('container/remote-session headers only set when env vars present', () => {
    // Spread-conditional pattern: avoid sending empty-string header values.
    expect(source).toMatch(
      /\.\.\.\(containerId\s*\?\s*\{\s*'x-claude-remote-container-id':\s*containerId\s*\}\s*:\s*\{\}\)/,
    )
    expect(source).toMatch(
      /\.\.\.\(remoteSessionId\s*\?\s*\n?\s*\{\s*'x-claude-remote-session-id':\s*remoteSessionId\s*\}\s*\n?\s*:\s*\{\}\)/,
    )
  })

  test('SDK x-client-app header only set when CLAUDE_AGENT_SDK_CLIENT_APP env is present', () => {
    expect(source).toMatch(/CLAUDE_AGENT_SDK_CLIENT_APP/)
    expect(source).toMatch(
      /\.\.\.\(clientApp\s*\?\s*\{\s*'x-client-app':\s*clientApp\s*\}\s*:\s*\{\}\)/,
    )
  })

  test('x-anthropic-additional-protection set when CLAUDE_CODE_ADDITIONAL_PROTECTION truthy', () => {
    expect(source).toMatch(/readEnv\('CLAUDE_CODE_ADDITIONAL_PROTECTION'\)/)
    expect(source).toMatch(
      /defaultHeaders\['x-anthropic-additional-protection'\]\s*=\s*'true'/,
    )
  })

  test('OAuth token refresh runs BEFORE getCredentials (avoid using stale token)', () => {
    const refreshIdx = source.indexOf('await authProvider.refresh()')
    const getCredsIdx = source.indexOf('await authProvider.getCredentials')
    expect(refreshIdx).toBeGreaterThan(0)
    expect(getCredsIdx).toBeGreaterThan(refreshIdx)
  })
})
