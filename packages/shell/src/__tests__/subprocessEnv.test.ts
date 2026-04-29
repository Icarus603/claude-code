import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const realEnvUtils = await import('@claude-code/config/env/utils')
const envOverrides = new Map<string, string>()

mock.module('@claude-code/config/env/utils', () => ({
  ...realEnvUtils,
  readEnv: (key: string) => envOverrides.get(key) ?? '',
  getAllEnv: () => Object.fromEntries(envOverrides),
  isEnvTruthy: (val: string | undefined) => {
    if (!val) return false
    const lc = val.toLowerCase()
    return lc === '1' || lc === 'true' || lc === 'yes'
  },
}))

const { registerUpstreamProxyEnvFn, subprocessEnv } = await import(
  '../subprocessEnv.js'
)

beforeEach(() => {
  envOverrides.clear()
  // Reset any registered upstream proxy fn between tests.
  registerUpstreamProxyEnvFn(() => ({}))
})

afterEach(() => {
  envOverrides.clear()
})

describe('subprocessEnv — scrub disabled (default)', () => {
  test('returns full env when scrub flag unset', () => {
    envOverrides.set('FOO', 'bar')
    envOverrides.set('ANTHROPIC_API_KEY', 'sk-ant-secret')
    const env = subprocessEnv()
    expect(env.FOO).toBe('bar')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-secret')
  })

  test('returns full env when scrub flag is "0"', () => {
    envOverrides.set('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', '0')
    envOverrides.set('ANTHROPIC_API_KEY', 'sk-ant-secret')
    expect(subprocessEnv().ANTHROPIC_API_KEY).toBe('sk-ant-secret')
  })

  test('returns full env when scrub flag is "false"', () => {
    envOverrides.set('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', 'false')
    envOverrides.set('ANTHROPIC_API_KEY', 'sk-ant-secret')
    expect(subprocessEnv().ANTHROPIC_API_KEY).toBe('sk-ant-secret')
  })
})

describe('subprocessEnv — scrub enabled', () => {
  beforeEach(() => {
    envOverrides.set('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', '1')
  })

  // Critical security contract: when scrub is enabled (CI / GHA mode),
  // these secrets MUST be deleted from subprocess env. Prevents
  // prompt-injection exfil via shell expansion.

  test('strips ANTHROPIC_API_KEY', () => {
    envOverrides.set('ANTHROPIC_API_KEY', 'secret')
    expect(subprocessEnv().ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('strips CLAUDE_CODE_OAUTH_TOKEN', () => {
    envOverrides.set('CLAUDE_CODE_OAUTH_TOKEN', 'secret')
    expect(subprocessEnv().CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })

  test('strips ANTHROPIC_AUTH_TOKEN', () => {
    envOverrides.set('ANTHROPIC_AUTH_TOKEN', 'secret')
    expect(subprocessEnv().ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })

  test('strips AWS_SECRET_ACCESS_KEY', () => {
    envOverrides.set('AWS_SECRET_ACCESS_KEY', 'secret')
    expect(subprocessEnv().AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  test('strips AWS_SESSION_TOKEN', () => {
    envOverrides.set('AWS_SESSION_TOKEN', 'secret')
    expect(subprocessEnv().AWS_SESSION_TOKEN).toBeUndefined()
  })

  test('strips GOOGLE_APPLICATION_CREDENTIALS', () => {
    envOverrides.set('GOOGLE_APPLICATION_CREDENTIALS', '/path/to/creds.json')
    expect(subprocessEnv().GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined()
  })

  test('strips AZURE_CLIENT_SECRET', () => {
    envOverrides.set('AZURE_CLIENT_SECRET', 'secret')
    expect(subprocessEnv().AZURE_CLIENT_SECRET).toBeUndefined()
  })

  test('strips ACTIONS_ID_TOKEN_REQUEST_TOKEN (GHA OIDC)', () => {
    envOverrides.set('ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'oidc-token')
    expect(subprocessEnv().ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBeUndefined()
  })

  test('strips OTEL_EXPORTER_OTLP_HEADERS (telemetry creds)', () => {
    envOverrides.set('OTEL_EXPORTER_OTLP_HEADERS', 'Authorization=secret')
    expect(subprocessEnv().OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined()
  })

  test('strips ANTHROPIC_CUSTOM_HEADERS (may contain auth)', () => {
    envOverrides.set('ANTHROPIC_CUSTOM_HEADERS', 'Authorization=Bearer xxx')
    expect(subprocessEnv().ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
  })

  test('strips SSH_SIGNING_KEY', () => {
    envOverrides.set('SSH_SIGNING_KEY', 'ssh-key-contents')
    expect(subprocessEnv().SSH_SIGNING_KEY).toBeUndefined()
  })
})

describe('subprocessEnv — INPUT_-prefixed scrubbing', () => {
  // Critical: GitHub Actions exposes step inputs as INPUT_FOO env vars.
  // If an action's input was named "ANTHROPIC_API_KEY" (rare but possible),
  // it'd be exposed as INPUT_ANTHROPIC_API_KEY. Scrub both forms.

  beforeEach(() => {
    envOverrides.set('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', '1')
  })

  test('strips INPUT_ANTHROPIC_API_KEY', () => {
    envOverrides.set('INPUT_ANTHROPIC_API_KEY', 'leaked-via-action-input')
    expect(subprocessEnv().INPUT_ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('strips INPUT_AWS_SECRET_ACCESS_KEY', () => {
    envOverrides.set('INPUT_AWS_SECRET_ACCESS_KEY', 'secret')
    expect(subprocessEnv().INPUT_AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  test('strips INPUT_OVERRIDE_GITHUB_TOKEN', () => {
    envOverrides.set('INPUT_OVERRIDE_GITHUB_TOKEN', 'github-token')
    expect(subprocessEnv().INPUT_OVERRIDE_GITHUB_TOKEN).toBeUndefined()
  })

  test('non-listed INPUT_ vars are NOT stripped (only the secret allowlist)', () => {
    envOverrides.set('INPUT_FOO', 'safe-value')
    envOverrides.set('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', '1')
    expect(subprocessEnv().INPUT_FOO).toBe('safe-value')
  })
})

describe('subprocessEnv — non-secret env preserved', () => {
  beforeEach(() => {
    envOverrides.set('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', '1')
  })

  test('PATH preserved even with scrub on', () => {
    envOverrides.set('PATH', '/usr/bin:/bin')
    expect(subprocessEnv().PATH).toBe('/usr/bin:/bin')
  })

  test('HOME preserved even with scrub on', () => {
    envOverrides.set('HOME', '/users/me')
    expect(subprocessEnv().HOME).toBe('/users/me')
  })

  test('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB itself preserved (the flag)', () => {
    expect(subprocessEnv().CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('1')
  })
})

describe('subprocessEnv — upstream proxy injection', () => {
  test('proxy env injected when register fn returns values (no scrub)', () => {
    registerUpstreamProxyEnvFn(() => ({
      HTTPS_PROXY: 'http://proxy:8080',
      HTTP_PROXY: 'http://proxy:8080',
    }))
    envOverrides.set('FOO', 'bar')
    const env = subprocessEnv()
    expect(env.FOO).toBe('bar')
    expect(env.HTTPS_PROXY).toBe('http://proxy:8080')
    expect(env.HTTP_PROXY).toBe('http://proxy:8080')
  })

  test('proxy env overrides existing env values (spread order)', () => {
    registerUpstreamProxyEnvFn(() => ({ HTTPS_PROXY: 'http://override:9999' }))
    envOverrides.set('HTTPS_PROXY', 'http://existing:8080')
    expect(subprocessEnv().HTTPS_PROXY).toBe('http://override:9999')
  })

  test('proxy env injected BEFORE scrub — proxy values themselves can be scrubbed if listed', () => {
    // The spread `{ ...env, ...proxyEnv }` happens BEFORE the scrub loop,
    // so proxy values that match scrubbed names are also stripped.
    registerUpstreamProxyEnvFn(() => ({ ANTHROPIC_API_KEY: 'proxy-injected' }))
    envOverrides.set('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', '1')
    expect(subprocessEnv().ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('no proxy fn registered returns empty object', () => {
    // Default: no fn registered → no proxy env.
    registerUpstreamProxyEnvFn(() => ({}))
    envOverrides.set('FOO', 'bar')
    expect(subprocessEnv().FOO).toBe('bar')
  })
})
