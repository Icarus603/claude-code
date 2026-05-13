import { describe, expect, test } from 'bun:test'

import {
  ALL_OAUTH_SCOPES,
  CLAUDE_AI_INFERENCE_SCOPE,
  CLAUDE_AI_OAUTH_SCOPES,
  CLAUDE_AI_PROFILE_SCOPE,
  CONSOLE_OAUTH_SCOPES,
  LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS,
  MCP_CLIENT_METADATA_URL,
  OAUTH_BETA_HEADER,
  getOauthConfig,
} from '../oauthConstants.js'

/**
 * Byte-for-byte parity with ant oauthConstants (0553.js + 0554.js).
 *
 * The values here ARE the wire protocol — a wrong CLIENT_ID hits the wrong
 * OAuth app, a wrong scope rejects the auth code at exchange, a wrong
 * beta header gets the OAuth flow filtered out at the API gateway. Each
 * value is paired with its ant source-of-truth identifier in the test
 * description.
 */
describe('oauthConstants (ant 0553.js/0554.js parity)', () => {
  test('OAUTH_BETA_HEADER matches ant ij="oauth-2025-04-20"', () => {
    expect(OAUTH_BETA_HEADER).toBe('oauth-2025-04-20')
  })

  test('CLAUDE_AI_INFERENCE_SCOPE matches ant OB="user:inference"', () => {
    expect(CLAUDE_AI_INFERENCE_SCOPE).toBe('user:inference')
  })

  test('CLAUDE_AI_PROFILE_SCOPE matches ant XfH="user:profile"', () => {
    expect(CLAUDE_AI_PROFILE_SCOPE).toBe('user:profile')
  })

  test('CONSOLE_OAUTH_SCOPES matches ant M4q=[kP4=org:create_api_key, XfH]', () => {
    expect([...CONSOLE_OAUTH_SCOPES]).toEqual(['org:create_api_key', 'user:profile'])
  })

  test('CLAUDE_AI_OAUTH_SCOPES matches ant vy_ — full 5-scope list with file_upload', () => {
    expect([...CLAUDE_AI_OAUTH_SCOPES]).toEqual([
      'user:profile',
      'user:inference',
      'user:sessions:claude_code',
      'user:mcp_servers',
      'user:file_upload',
    ])
  })

  test('ALL_OAUTH_SCOPES dedupes Console + Claude.ai union (ant DS6=N9([...M4q,...vy_]))', () => {
    expect(ALL_OAUTH_SCOPES).toEqual([
      'org:create_api_key',
      'user:profile',
      'user:inference',
      'user:sessions:claude_code',
      'user:mcp_servers',
      'user:file_upload',
    ])
  })

  test('LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS = 31536000 (1 year, ant ffH)', () => {
    expect(LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS).toBe(31_536_000)
    expect(LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS).toBe(365 * 24 * 60 * 60)
  })

  test('MCP_CLIENT_METADATA_URL points to Anthropic-hosted CIMD JSON (ant MS6)', () => {
    expect(MCP_CLIENT_METADATA_URL).toBe(
      'https://claude.ai/oauth/claude-code-client-metadata',
    )
  })

  describe('production OAuth config (ant j4q)', () => {
    const config = getOauthConfig()

    test('CLIENT_ID matches ant production GUID', () => {
      expect(config.CLIENT_ID).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e')
    })

    test('BASE_API_URL = https://api.anthropic.com', () => {
      expect(config.BASE_API_URL).toBe('https://api.anthropic.com')
    })

    test('CLAUDE_AI_AUTHORIZE_URL bounces through claude.com/cai/* for attribution', () => {
      expect(config.CLAUDE_AI_AUTHORIZE_URL).toBe(
        'https://claude.com/cai/oauth/authorize',
      )
    })

    test('CLAUDE_AI_ORIGIN is claude.ai (not derived from AUTHORIZE_URL)', () => {
      // The .origin check is the reason these two diverge — using
      // claude.com would break links to /code, /settings/connectors, etc.
      expect(config.CLAUDE_AI_ORIGIN).toBe('https://claude.ai')
    })

    test('CONSOLE_AUTHORIZE_URL points to platform.claude.com', () => {
      expect(config.CONSOLE_AUTHORIZE_URL).toBe(
        'https://platform.claude.com/oauth/authorize',
      )
    })

    test('TOKEN_URL = https://platform.claude.com/v1/oauth/token', () => {
      expect(config.TOKEN_URL).toBe('https://platform.claude.com/v1/oauth/token')
    })

    test('API_KEY_URL routes through api.anthropic.com (NOT platform.claude.com)', () => {
      expect(config.API_KEY_URL).toBe(
        'https://api.anthropic.com/api/oauth/claude_cli/create_api_key',
      )
    })

    test('ROLES_URL routes through api.anthropic.com', () => {
      expect(config.ROLES_URL).toBe(
        'https://api.anthropic.com/api/oauth/claude_cli/roles',
      )
    })

    test('MANUAL_REDIRECT_URL points to platform.claude.com/oauth/code/callback', () => {
      expect(config.MANUAL_REDIRECT_URL).toBe(
        'https://platform.claude.com/oauth/code/callback',
      )
    })

    test('MCP_PROXY_URL + MCP_PROXY_PATH split is preserved (server_id template)', () => {
      expect(config.MCP_PROXY_URL).toBe('https://mcp-proxy.anthropic.com')
      expect(config.MCP_PROXY_PATH).toBe('/v1/mcp/{server_id}')
    })
  })
})
