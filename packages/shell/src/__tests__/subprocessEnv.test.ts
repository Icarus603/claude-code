import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  registerUpstreamProxyEnvFn,
  subprocessEnv,
} from '../subprocessEnv.js'

// Each test passes an explicit env via DI — no mock.module, no process-wide
// pollution. Pre-DI versions of this file mocked @claude-code/config/env/utils,
// which is process-wide in bun-test (no unmock API) and silently broke tests
// in OTHER files that ran later in the same process — most visibly on Linux
// where bun-test's readdir order made this file run before
// import.test.ts and live-fire-smoke.test.ts (both lost PATH and HOME).

beforeEach(() => {
  registerUpstreamProxyEnvFn(() => ({}))
})

afterEach(() => {
  registerUpstreamProxyEnvFn(() => ({}))
})

describe('subprocessEnv — scrub disabled (default)', () => {
  test('returns full env when scrub flag unset', () => {
    const env = subprocessEnv({ FOO: 'bar', ANTHROPIC_API_KEY: 'sk-ant-secret' })
    expect(env.FOO).toBe('bar')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-secret')
  })

  test('returns full env when scrub flag is "0"', () => {
    expect(
      subprocessEnv({
        CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '0',
        ANTHROPIC_API_KEY: 'sk-ant-secret',
      }).ANTHROPIC_API_KEY,
    ).toBe('sk-ant-secret')
  })

  test('returns full env when scrub flag is "false"', () => {
    expect(
      subprocessEnv({
        CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: 'false',
        ANTHROPIC_API_KEY: 'sk-ant-secret',
      }).ANTHROPIC_API_KEY,
    ).toBe('sk-ant-secret')
  })
})

describe('subprocessEnv — scrub enabled', () => {
  // Critical security contract: when scrub is enabled (CI / GHA mode),
  // these secrets MUST be deleted from subprocess env. Prevents
  // prompt-injection exfil via shell expansion.
  const scrubOn = (extra: Record<string, string>) =>
    subprocessEnv({ CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', ...extra })

  test('strips ANTHROPIC_API_KEY', () => {
    expect(scrubOn({ ANTHROPIC_API_KEY: 'secret' }).ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('strips CLAUDE_CODE_OAUTH_TOKEN', () => {
    expect(scrubOn({ CLAUDE_CODE_OAUTH_TOKEN: 'secret' }).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  test('strips ANTHROPIC_AUTH_TOKEN', () => {
    expect(scrubOn({ ANTHROPIC_AUTH_TOKEN: 'secret' }).ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })

  test('strips AWS_SECRET_ACCESS_KEY', () => {
    expect(scrubOn({ AWS_SECRET_ACCESS_KEY: 'secret' }).AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  test('strips AWS_SESSION_TOKEN', () => {
    expect(scrubOn({ AWS_SESSION_TOKEN: 'secret' }).AWS_SESSION_TOKEN).toBeUndefined()
  })

  test('strips GOOGLE_APPLICATION_CREDENTIALS', () => {
    expect(
      scrubOn({ GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json' }).GOOGLE_APPLICATION_CREDENTIALS,
    ).toBeUndefined()
  })

  test('strips AZURE_CLIENT_SECRET', () => {
    expect(scrubOn({ AZURE_CLIENT_SECRET: 'secret' }).AZURE_CLIENT_SECRET).toBeUndefined()
  })

  test('strips ACTIONS_ID_TOKEN_REQUEST_TOKEN (GHA OIDC)', () => {
    expect(
      scrubOn({ ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-token' }).ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    ).toBeUndefined()
  })

  test('strips OTEL_EXPORTER_OTLP_HEADERS (telemetry creds)', () => {
    expect(
      scrubOn({ OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=secret' }).OTEL_EXPORTER_OTLP_HEADERS,
    ).toBeUndefined()
  })

  test('strips ANTHROPIC_CUSTOM_HEADERS (may contain auth)', () => {
    expect(
      scrubOn({ ANTHROPIC_CUSTOM_HEADERS: 'Authorization=Bearer xxx' }).ANTHROPIC_CUSTOM_HEADERS,
    ).toBeUndefined()
  })

  test('strips SSH_SIGNING_KEY', () => {
    expect(scrubOn({ SSH_SIGNING_KEY: 'ssh-key-contents' }).SSH_SIGNING_KEY).toBeUndefined()
  })
})

describe('subprocessEnv — INPUT_-prefixed scrubbing', () => {
  // Critical: GitHub Actions exposes step inputs as INPUT_FOO env vars.
  // If an action's input was named "ANTHROPIC_API_KEY" (rare but possible),
  // it'd be exposed as INPUT_ANTHROPIC_API_KEY. Scrub both forms.
  const scrubOn = (extra: Record<string, string>) =>
    subprocessEnv({ CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', ...extra })

  test('strips INPUT_ANTHROPIC_API_KEY', () => {
    expect(
      scrubOn({ INPUT_ANTHROPIC_API_KEY: 'leaked-via-action-input' }).INPUT_ANTHROPIC_API_KEY,
    ).toBeUndefined()
  })

  test('strips INPUT_AWS_SECRET_ACCESS_KEY', () => {
    expect(scrubOn({ INPUT_AWS_SECRET_ACCESS_KEY: 'secret' }).INPUT_AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  test('strips INPUT_OVERRIDE_GITHUB_TOKEN', () => {
    expect(scrubOn({ INPUT_OVERRIDE_GITHUB_TOKEN: 'github-token' }).INPUT_OVERRIDE_GITHUB_TOKEN).toBeUndefined()
  })

  test('non-listed INPUT_ vars are NOT stripped (only the secret allowlist)', () => {
    expect(scrubOn({ INPUT_FOO: 'safe-value' }).INPUT_FOO).toBe('safe-value')
  })
})

describe('subprocessEnv — non-secret env preserved', () => {
  const scrubOn = (extra: Record<string, string>) =>
    subprocessEnv({ CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', ...extra })

  test('PATH preserved even with scrub on', () => {
    expect(scrubOn({ PATH: '/usr/bin:/bin' }).PATH).toBe('/usr/bin:/bin')
  })

  test('HOME preserved even with scrub on', () => {
    expect(scrubOn({ HOME: '/users/me' }).HOME).toBe('/users/me')
  })

  test('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB itself preserved (the flag)', () => {
    expect(scrubOn({}).CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('1')
  })
})

describe('subprocessEnv — upstream proxy injection', () => {
  test('proxy env injected when register fn returns values (no scrub)', () => {
    registerUpstreamProxyEnvFn(() => ({
      HTTPS_PROXY: 'http://proxy:8080',
      HTTP_PROXY: 'http://proxy:8080',
    }))
    const env = subprocessEnv({ FOO: 'bar' })
    expect(env.FOO).toBe('bar')
    expect(env.HTTPS_PROXY).toBe('http://proxy:8080')
    expect(env.HTTP_PROXY).toBe('http://proxy:8080')
  })

  test('proxy env overrides existing env values (spread order)', () => {
    registerUpstreamProxyEnvFn(() => ({ HTTPS_PROXY: 'http://override:9999' }))
    expect(
      subprocessEnv({ HTTPS_PROXY: 'http://existing:8080' }).HTTPS_PROXY,
    ).toBe('http://override:9999')
  })

  test('proxy env injected BEFORE scrub — proxy values themselves can be scrubbed if listed', () => {
    // The spread `{ ...env, ...proxyEnv }` happens BEFORE the scrub loop,
    // so proxy values that match scrubbed names are also stripped.
    registerUpstreamProxyEnvFn(() => ({ ANTHROPIC_API_KEY: 'proxy-injected' }))
    expect(
      subprocessEnv({ CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' }).ANTHROPIC_API_KEY,
    ).toBeUndefined()
  })

  test('no proxy fn registered returns empty object', () => {
    registerUpstreamProxyEnvFn(() => ({}))
    expect(subprocessEnv({ FOO: 'bar' }).FOO).toBe('bar')
  })
})
