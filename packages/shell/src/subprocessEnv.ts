import { getAllEnv, isEnvTruthy, readEnv } from '@claude-code/config/env/utils'

/**
 * Env vars to strip from subprocess environments when running inside GitHub
 * Actions. Prevents prompt-injection attacks from exfiltrating secrets via
 * shell expansion in Bash tool commands.
 */
const GHA_SUBPROCESS_SCRUB = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',
  'ALL_INPUTS',
  'OVERRIDE_GITHUB_TOKEN',
  'DEFAULT_WORKFLOW_TOKEN',
  'SSH_SIGNING_KEY',
] as const

// Registered by init.ts after the upstreamproxy module is dynamically imported
// in CCR sessions.
let _getUpstreamProxyEnv: (() => Record<string, string>) | undefined

export function registerUpstreamProxyEnvFn(
  fn: () => Record<string, string>,
): void {
  _getUpstreamProxyEnv = fn
}

/**
 * Build subprocess env. Pass an explicit `env` to bypass real process.env
 * (used in tests — eliminates the need for mock.module on env utils, which
 * is process-wide in bun-test and pollutes other test files). Production
 * callers omit the param and the function reads from getAllEnv()/readEnv()
 * directly.
 */
export function subprocessEnv(
  env?: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const baseEnv = env ?? getAllEnv()
  const scrubFlag = env ? env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB : readEnv('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB')
  const proxyEnv = _getUpstreamProxyEnv?.() ?? {}

  if (!isEnvTruthy(scrubFlag)) {
    return Object.keys(proxyEnv).length > 0
      ? { ...baseEnv, ...proxyEnv }
      : (baseEnv as NodeJS.ProcessEnv)
  }
  const merged = { ...baseEnv, ...proxyEnv }
  for (const k of GHA_SUBPROCESS_SCRUB) {
    delete merged[k]
    delete merged[`INPUT_${k}`]
  }
  return merged as NodeJS.ProcessEnv
}
